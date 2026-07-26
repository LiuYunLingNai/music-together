package io.github.yueby.musictogether.player

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
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

data class PlayerUiState(
    val track: Track? = null,
    val playing: Boolean = false,
    val positionSeconds: Double = 0.0,
    val bufferedPercent: Int = 0,
    val error: String? = null,
)

class NativePlayer(
    context: Context,
    private val scope: CoroutineScope,
    private val clock: ClockSync,
    private val onTrackEnded: () -> Unit,
) {
    private val exoPlayer = ExoPlayer.Builder(context).build()
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()
    private var scheduledAction: Job? = null
    private var progressJob: Job? = null
    private var hardSeekConfirmations = 0

    init {
        exoPlayer.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        exoPlayer.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) = publish()
            override fun onPlaybackStateChanged(playbackState: Int) {
                publish()
                if (playbackState == Player.STATE_ENDED) onTrackEnded()
            }
            override fun onPlayerError(error: PlaybackException) {
                _state.value = _state.value.copy(error = "播放失败：${error.errorCodeName}")
            }
        })
        progressJob = scope.launch {
            while (isActive) {
                publish()
                delay(250)
            }
        }
    }

    fun load(track: Track, playState: PlayState) {
        val streamUrl = track.streamUrl ?: return
        scheduledAction?.cancel()
        hardSeekConfirmations = 0
        _state.value = PlayerUiState(track = track)
        exoPlayer.setMediaItem(MediaItem.fromUri(streamUrl))
        exoPlayer.prepare()
        val elapsed = if (playState.isPlaying) max(0.0, (clock.serverTime() - playState.serverTimestamp) / 1000.0) else 0.0
        exoPlayer.seekTo(((playState.currentTime + elapsed) * 1000).toLong().coerceAtLeast(0))
        exoPlayer.playWhenReady = false
        exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
        if (playState.isPlaying) schedule(playState.serverTimeToExecute) { exoPlayer.play() }
    }

    fun recover(track: Track, playState: PlayState) {
        if (_state.value.track?.id == track.id) return
        load(track, playState)
    }

    fun pause(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        exoPlayer.pause()
        exoPlayer.seekTo((playState.currentTime * 1000).toLong())
        exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
    }

    fun resume(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        exoPlayer.seekTo((playState.currentTime * 1000).toLong())
        exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
        exoPlayer.play()
    }

    fun seek(playState: PlayState) = schedule(playState.serverTimeToExecute) {
        exoPlayer.seekTo((playState.currentTime * 1000).toLong())
        exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
    }

    fun correctDrift(expectedSeconds: Double, serverIsPlaying: Boolean, adaptiveThresholdMs: Long) {
        if (!exoPlayer.isPlaying || !serverIsPlaying) return
        val current = exoPlayer.currentPosition / 1000.0
        val drift = current - expectedSeconds
        val threshold = max(200L, adaptiveThresholdMs) / 1000.0
        if (abs(drift) > threshold) {
            hardSeekConfirmations++
            if (hardSeekConfirmations >= 2) {
                exoPlayer.seekTo((expectedSeconds * 1000).toLong().coerceAtLeast(0))
                exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
                hardSeekConfirmations = 0
            }
        } else if (abs(drift) > 0.03) {
            hardSeekConfirmations = 0
            val adjustment = (drift * 0.25).coerceIn(-0.02, 0.02)
            exoPlayer.playbackParameters = PlaybackParameters((1.0 - adjustment).toFloat())
        } else {
            hardSeekConfirmations = 0
            exoPlayer.playbackParameters = PlaybackParameters.DEFAULT
        }
    }

    fun currentPositionSeconds(): Double = exoPlayer.currentPosition.coerceAtLeast(0) / 1000.0

    fun stop() {
        scheduledAction?.cancel()
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        _state.value = PlayerUiState()
    }

    fun release() {
        progressJob?.cancel()
        scheduledAction?.cancel()
        exoPlayer.release()
    }

    private fun schedule(serverTime: Long?, action: () -> Unit) {
        scheduledAction?.cancel()
        scheduledAction = scope.launch {
            val waitMs = if (serverTime != null && clock.calibrated) {
                (serverTime - clock.serverTime()).coerceAtLeast(0)
            } else 0
            if (waitMs > 0) delay(waitMs)
            action()
            publish()
        }
    }

    private fun publish() {
        _state.value = _state.value.copy(
            playing = exoPlayer.isPlaying,
            positionSeconds = exoPlayer.currentPosition.coerceAtLeast(0) / 1000.0,
            bufferedPercent = exoPlayer.bufferedPercentage,
        )
    }
}
