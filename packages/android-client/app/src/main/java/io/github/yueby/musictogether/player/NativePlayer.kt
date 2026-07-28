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
import kotlin.math.abs
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
    private val onTrackEnded: () -> Unit,
) {
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
    private var hardSeekConfirmations = 0
    private var trackLoadedAtMs = 0L
    private var pendingLoad: PendingLoad? = null

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
            AppLogger.error("Player", "playback failed code=${error.errorCodeName}", error)
            _state.value = _state.value.copy(error = "播放失败：${error.errorCodeName}")
        }
    }

    fun load(track: Track, playState: PlayState) {
        val streamUrl = track.streamUrl ?: run {
            AppLogger.warn("Player", "track has no stream URL id=${track.id}")
            return
        }
        scheduledAction?.cancel()
        pendingLoad = null
        hardSeekConfirmations = 0
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
        it.pause()
        it.seekTo((playState.currentTime * 1000).toLong())
        it.playbackParameters = PlaybackParameters.DEFAULT
    }

    fun resume(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        it.seekTo((playState.currentTime * 1000).toLong())
        it.playbackParameters = PlaybackParameters.DEFAULT
        it.play()
    }

    fun seek(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        it.seekTo((playState.currentTime * 1000).toLong())
        it.playbackParameters = PlaybackParameters.DEFAULT
    }

    /**
     * Android decoders may audibly glitch when playback speed is changed every few seconds.
     * We therefore keep 1.0x speed and only hard-seek after a large, sustained drift.
     */
    fun correctDrift(expectedSeconds: Double, serverIsPlaying: Boolean, adaptiveThresholdMs: Long) {
        val controller = player ?: return
        if (!controller.isPlaying || !serverIsPlaying || controller.playbackState != Player.STATE_READY) return
        if (System.currentTimeMillis() - trackLoadedAtMs < 3_000) return
        val current = controller.currentPosition / 1000.0
        val drift = current - expectedSeconds
        val threshold = max(1_200L, adaptiveThresholdMs) / 1000.0
        AppLogger.debug("Sync", "driftMs=${(drift * 1000).toLong()} thresholdMs=${(threshold * 1000).toLong()}")
        controller.playbackParameters = PlaybackParameters.DEFAULT
        if (abs(drift) > threshold) {
            hardSeekConfirmations++
            if (hardSeekConfirmations >= 2) {
                AppLogger.warn("Sync", "hard seek from=${controller.currentPosition} to=${(expectedSeconds * 1000).toLong()}")
                controller.seekTo((expectedSeconds * 1000).toLong().coerceAtLeast(0))
                hardSeekConfirmations = 0
            }
        } else {
            hardSeekConfirmations = 0
        }
    }

    fun currentPositionSeconds(): Double = player?.currentPosition?.coerceAtLeast(0)?.div(1000.0) ?: 0.0

    fun stop() {
        scheduledAction?.cancel()
        pendingLoad = null
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
                it.playbackParameters = PlaybackParameters.DEFAULT
                it.seekTo(expectedPositionMs)
                if (pending.autoPlay) it.play() else it.pause()
            }
            trackLoadedAtMs = System.currentTimeMillis()
            publish()
        }
    }

    private fun withPlayer(action: (MediaController) -> Unit) {
        val current = player
        if (current != null) action(current) else pendingOperations += { action(this) }
    }

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
