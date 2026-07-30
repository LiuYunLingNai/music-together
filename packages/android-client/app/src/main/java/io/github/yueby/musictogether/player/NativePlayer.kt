package io.github.yueby.musictogether.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.datasource.HttpDataSource
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.max

@Immutable
data class PlayerUiState(
    val track: Track? = null,
    val playing: Boolean = false,
    val positionSeconds: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val bufferedPercent: Int = 0,
    val error: String? = null,
    val connectedToMediaSession: Boolean = false,
)

class NativePlayer(
    context: Context,
    private val scope: CoroutineScope,
    private val clock: ClockSync,
    initialTempoSyncEnabled: Boolean,
    initialHardSeekSyncEnabled: Boolean,
    private val onTrackEnded: () -> Unit,
) {
    private companion object {
        const val HARD_SEEK_FADE_MS = 60L
        const val FADE_STEPS = 4
    }

    private data class PendingLoad(
        val trackId: String,
        val basePositionMs: Long,
        val serverTimestamp: Long,
        val executeAt: Long?,
        val autoPlay: Boolean,
    )

    private val appContext = context.applicationContext
    private val controllerFuture = MediaController.Builder(
        appContext,
        SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java)),
    ).buildAsync()
    private var player: MediaController? = null
    private val pendingOperations = ArrayDeque<MediaController.() -> Unit>()
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()
    private var scheduledAction: Job? = null
    private var progressJob: Job? = null
    private var pendingLoad: PendingLoad? = null
    private var fallbackPlaybackUrl: String? = null
    private val driftController = PlaybackDriftController()
    private var tempoSyncEnabled = initialTempoSyncEnabled
    private var hardSeekSyncEnabled = initialHardSeekSyncEnabled
    private var hardSeekJob: Job? = null
    private var hardSeekRestoreVolume: Float? = null
    private var correctionGeneration = 0L

    init {
        controllerFuture.addListener({
            runCatching { controllerFuture.get() }
                .onSuccess { controller ->
                    player = controller
                    controller.addListener(playerListener)
                    while (pendingOperations.isNotEmpty()) pendingOperations.removeFirst().invoke(controller)
                    _state.value = _state.value.copy(connectedToMediaSession = true)
                    AppLogger.info("Player", "connected to Android MediaSession")
                    publish()
                }
                .onFailure {
                    AppLogger.error("Player", "failed to connect Android MediaSession", it)
                    _state.value = _state.value.copy(error = "无法连接安卓媒体播放器：${it.message}")
                }
        }, ContextCompat.getMainExecutor(appContext))

        progressJob = scope.launch {
            while (isActive) {
                publish()
                delay(250)
            }
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) = publish()

        override fun onPlaybackStateChanged(playbackState: Int) {
            publish()
            if (playbackState == Player.STATE_READY) finishPendingLoad()
            if (playbackState == Player.STATE_ENDED) onTrackEnded()
        }

        override fun onPlayerError(error: PlaybackException) {
            if (retryWithFallback(error)) return
            AppLogger.error(
                "Player",
                "playback failed code=${error.errorCodeName} status=${httpResponseCode(error) ?: "n/a"} " +
                    "target=${currentPlaybackTarget()}",
                error,
            )
            _state.value = _state.value.copy(error = "播放失败：${error.errorCodeName}")
        }
    }

    fun load(
        track: Track,
        playState: PlayState,
        playbackUrl: String? = track.streamUrl,
        fallbackUrl: String? = null,
    ) {
        val streamUrl = playbackUrl ?: run {
            fallbackPlaybackUrl = null
            AppLogger.warn("Player", "track has no stream URL id=${track.id}")
            return
        }
        scheduledAction?.cancel()
        pendingLoad = null
        fallbackPlaybackUrl = fallbackUrl?.takeIf { it != streamUrl }
        resetPlaybackCorrection()
        _state.value = PlayerUiState(track = track, connectedToMediaSession = player != null)
        val elapsed = if (playState.isPlaying && playState.serverTimestamp > 0) {
            max(0.0, (clock.serverTime() - playState.serverTimestamp) / 1000.0)
        } else 0.0
        val positionMs = ((playState.currentTime + elapsed) * 1000).toLong().coerceAtLeast(0)
        pendingLoad = PendingLoad(
            trackId = track.id,
            basePositionMs = (playState.currentTime * 1000).toLong().coerceAtLeast(0),
            serverTimestamp = playState.serverTimestamp,
            executeAt = playState.serverTimeToExecute,
            autoPlay = playState.isPlaying,
        )
        AppLogger.info(
            "Player",
            "load track=${track.id} source=${track.source} positionMs=$positionMs scheduled=${playState.serverTimeToExecute}",
        )
        withPlayer { controller ->
            val metadata = MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist.joinToString(" / "))
                .setAlbumTitle(track.album)
                .setArtworkUri(track.cover.takeIf { it.isNotBlank() }?.let(Uri::parse))
                .build()
            val mediaItem = MediaItem.Builder()
                    .setMediaId(track.id)
                    .setUri(streamUrl)
                    .setMediaMetadata(metadata)
                    .build()
            controller.playWhenReady = false
            controller.playbackParameters = PlaybackParameters.DEFAULT
            controller.setMediaItem(mediaItem, positionMs)
            controller.prepare()
        }
    }

    fun recover(track: Track, playState: PlayState) {
        if (_state.value.track?.id == track.id) return
        load(track, playState)
    }

    fun updateTrackMetadata(track: Track) {
        if (_state.value.track?.id != track.id) return
        _state.value = _state.value.copy(track = track)
    }

    fun pause(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        resetPlaybackCorrection(it)
        it.pause()
        it.seekTo((playState.currentTime * 1000).toLong())
    }

    fun resume(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        resetPlaybackCorrection(it)
        it.seekTo(positionAtExecution(playState, advanceIfLate = true))
        it.play()
    }

    fun seek(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        resetPlaybackCorrection(it)
        it.seekTo(positionAtExecution(playState, advanceIfLate = playState.isPlaying))
    }

    fun setTempoSyncEnabled(enabled: Boolean) {
        tempoSyncEnabled = enabled
        resetPlaybackCorrection()
        AppLogger.info("Sync", "tempo correction enabled=$enabled")
    }

    fun setHardSeekSyncEnabled(enabled: Boolean) {
        hardSeekSyncEnabled = enabled
        resetPlaybackCorrection()
        AppLogger.info("Sync", "hard seek correction enabled=$enabled")
    }

    fun correctDrift(expectedSeconds: Double, serverIsPlaying: Boolean, medianRttMs: Long): Double? {
        val controller = player ?: return null
        if (!serverIsPlaying) {
            resetPlaybackCorrection(controller)
            return 0.0
        }
        if (!controller.isPlaying || controller.playbackState != Player.STATE_READY) return null
        val current = controller.currentPosition / 1000.0
        val drift = current - expectedSeconds
        val correction = driftController.update(
            current,
            expectedSeconds,
            medianRttMs,
            tempoSyncEnabled,
            hardSeekSyncEnabled,
        )
        val displayedDrift = driftController.currentDriftSeconds
        AppLogger.debug(
            "Sync",
            "driftMs=${(drift * 1000).toLong()} rttMs=$medianRttMs correction=${correction.javaClass.simpleName}",
        )
        when (correction) {
            DriftCorrection.None -> Unit
            is DriftCorrection.Tempo -> setPlaybackSpeed(controller, correction.speed)
            is DriftCorrection.Seek -> performHardSeek(controller, correction.positionSeconds)
        }
        return displayedDrift
    }

    fun stop() {
        scheduledAction?.cancel()
        pendingLoad = null
        fallbackPlaybackUrl = null
        resetPlaybackCorrection()
        withPlayer {
            it.stop()
            it.clearMediaItems()
        }
        _state.value = PlayerUiState(connectedToMediaSession = player != null)
    }

    fun release() {
        progressJob?.cancel()
        scheduledAction?.cancel()
        pendingLoad = null
        fallbackPlaybackUrl = null
        resetPlaybackCorrection()
        player?.removeListener(playerListener)
        MediaController.releaseFuture(controllerFuture)
        player = null
    }

    private fun schedule(serverTime: Long?, action: (MediaController) -> Unit) {
        scheduledAction?.cancel()
        scheduledAction = scope.launch {
            val waitMs = if (serverTime != null && clock.calibrated) {
                (serverTime - clock.serverTime()).coerceAtLeast(0)
            } else 0
            if (waitMs > 0) delay(waitMs)
            withPlayer(action)
            publish()
        }
    }

    fun switchPlaybackUrl(trackId: String, playbackUrl: String) {
        withPlayer { controller ->
            val currentItem = controller.currentMediaItem ?: return@withPlayer
            if (currentItem.mediaId != trackId || currentItem.localConfiguration?.uri?.toString() == playbackUrl) {
                return@withPlayer
            }
            val positionMs = controller.currentPosition.coerceAtLeast(0)
            val shouldResume = controller.playWhenReady
            fallbackPlaybackUrl = null
            resetPlaybackCorrection(controller)
            AppLogger.info("Player", "switch playback transport track=$trackId positionMs=$positionMs")
            controller.playWhenReady = false
            controller.setMediaItem(currentItem.buildUpon().setUri(playbackUrl).build(), positionMs)
            controller.prepare()
            if (pendingLoad == null) controller.playWhenReady = shouldResume
        }
    }

    private fun retryWithFallback(error: PlaybackException): Boolean {
        val fallbackUrl = fallbackPlaybackUrl ?: return false
        val controller = player ?: return false
        val currentItem = controller.currentMediaItem ?: return false
        val positionMs = controller.currentPosition.coerceAtLeast(0)
        val shouldResume = controller.playWhenReady
        fallbackPlaybackUrl = null
        resetPlaybackCorrection(controller)
        AppLogger.warn(
            "Player",
            "direct playback failed; retry proxy code=${error.errorCodeName} status=${httpResponseCode(error) ?: "n/a"}",
        )
        controller.playWhenReady = false
        controller.setMediaItem(currentItem.buildUpon().setUri(fallbackUrl).build(), positionMs)
        controller.prepare()
        if (pendingLoad == null) controller.playWhenReady = shouldResume
        return true
    }

    private fun finishPendingLoad() {
        val pending = pendingLoad ?: return
        val controller = player ?: return
        if (controller.currentMediaItem?.mediaId != pending.trackId) return
        pendingLoad = null
        scheduledAction?.cancel()
        scheduledAction = scope.launch {
            val waitMs = if (pending.autoPlay && pending.executeAt != null && clock.calibrated) {
                (pending.executeAt - clock.serverTime()).coerceAtLeast(0)
            } else 0
            if (waitMs > 0) delay(waitMs)

            val elapsedMs = if (pending.autoPlay && pending.serverTimestamp > 0) {
                (clock.serverTime() - pending.serverTimestamp).coerceAtLeast(0)
            } else 0
            val expectedPositionMs = (pending.basePositionMs + elapsedMs).coerceAtLeast(0)
            AppLogger.info(
                "Player",
                "ready track=${pending.trackId} seekMs=$expectedPositionMs loadWaitMs=$waitMs " +
                    "durationMs=${controller.duration} playing=${pending.autoPlay}",
            )
            withPlayer {
                resetPlaybackCorrection(it)
                it.seekTo(expectedPositionMs)
                if (pending.autoPlay) it.play() else it.pause()
            }
            publish()
        }
    }

    private fun positionAtExecution(playState: PlayState, advanceIfLate: Boolean): Long {
        val lateByMs = if (advanceIfLate && playState.serverTimeToExecute != null && clock.calibrated) {
            (clock.serverTime() - playState.serverTimeToExecute).coerceAtLeast(0)
        } else {
            0
        }
        return ((playState.currentTime * 1000).toLong() + lateByMs).coerceAtLeast(0)
    }

    private fun setPlaybackSpeed(controller: MediaController, speed: Float) {
        val clamped = speed.coerceIn(0.99f, 1.01f)
        if (kotlin.math.abs(controller.playbackParameters.speed - clamped) < 0.0001f &&
            controller.playbackParameters.pitch == 1f
        ) return
        controller.playbackParameters = PlaybackParameters(clamped, 1f)
    }

    private fun resetPlaybackCorrection(controller: MediaController? = player) {
        driftController.reset()
        correctionGeneration++
        hardSeekJob?.cancel()
        hardSeekJob = null
        controller?.let { current ->
            hardSeekRestoreVolume?.let { current.volume = it }
            setPlaybackSpeed(current, 1f)
        }
        hardSeekRestoreVolume = null
    }

    private fun performHardSeek(controller: MediaController, targetSeconds: Double) {
        correctionGeneration++
        val generation = correctionGeneration
        hardSeekJob?.cancel()
        val restoreVolume = hardSeekRestoreVolume ?: controller.volume
        hardSeekRestoreVolume = restoreVolume
        setPlaybackSpeed(controller, 1f)
        AppLogger.warn(
            "Sync",
            "fade seek from=${controller.currentPosition} to=${(targetSeconds * 1000).toLong()}",
        )
        hardSeekJob = scope.launch {
            try {
                fadeVolume(controller, controller.volume, 0f, HARD_SEEK_FADE_MS, generation)
                if (player !== controller || correctionGeneration != generation || !controller.isPlaying) return@launch
                controller.seekTo((targetSeconds * 1000).toLong().coerceAtLeast(0))
                fadeVolume(controller, 0f, restoreVolume, HARD_SEEK_FADE_MS * 2, generation)
            } finally {
                if (player === controller && correctionGeneration == generation) {
                    controller.volume = restoreVolume
                    hardSeekRestoreVolume = null
                    hardSeekJob = null
                }
            }
        }
    }

    private suspend fun fadeVolume(
        controller: MediaController,
        from: Float,
        to: Float,
        durationMs: Long,
        generation: Long,
    ) {
        repeat(FADE_STEPS) { step ->
            delay(durationMs / FADE_STEPS)
            if (player !== controller || correctionGeneration != generation) return
            val progress = (step + 1f) / FADE_STEPS
            controller.volume = from + (to - from) * progress
        }
    }

    private fun withPlayer(action: (MediaController) -> Unit) {
        val current = player
        if (current != null) action(current) else pendingOperations += { action(this) }
    }

    private fun currentPlaybackTarget(): String {
        val uri = player?.currentMediaItem?.localConfiguration?.uri ?: return "unknown"
        return buildString {
            append(uri.scheme ?: "unknown")
            append("://")
            append(uri.host ?: "unknown")
            if (uri.port != -1) append(":${uri.port}")
        }
    }

    private fun httpResponseCode(error: Throwable): Int? =
        generateSequence(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
            .firstOrNull()
            ?.responseCode

    private fun publish() {
        val controller = player ?: return
        _state.value = _state.value.copy(
            playing = controller.isPlaying,
            positionSeconds = controller.currentPosition.coerceAtLeast(0) / 1000.0,
            durationSeconds = controller.duration.takeIf { it > 0 }?.div(1000.0) ?: 0.0,
            bufferedPercent = controller.bufferedPercentage,
            connectedToMediaSession = true,
        )
    }
}
