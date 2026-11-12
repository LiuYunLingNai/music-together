package io.github.yueby.musictogether.ui.player

import android.graphics.Matrix
import android.view.TextureView
import androidx.annotation.OptIn
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * Dynamic (video) cover: a muted, audio-less looping player layered over the static cover and
 * faded in once the first frame is rendered. Decoding stops while the activity is not started.
 */
@OptIn(UnstableApi::class)
@Composable
internal fun CoverVideo(url: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var ready by remember(url) { mutableStateOf(false) }
    var videoSize by remember(url) { mutableStateOf(IntSize.Zero) }
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            trackSelectionParameters = trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                .build()
            repeatMode = Player.REPEAT_MODE_ONE
            setMediaItem(MediaItem.fromUri(url))
            prepare()
        }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() {
                ready = true
            }

            override fun onVideoSizeChanged(size: VideoSize) {
                videoSize = IntSize(size.width, size.height)
            }

            override fun onPlayerError(error: PlaybackException) {
                ready = false
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }
    LifecycleStartEffect(player) {
        player.play()
        onStopOrDispose { player.pause() }
    }
    val alpha by animateFloatAsState(if (ready) 1f else 0f, tween(500), label = "cover-video-alpha")
    AndroidView(
        factory = { TextureView(it).also(player::setVideoTextureView) },
        update = { view -> view.centerCrop(videoSize) },
        modifier = modifier.graphicsLayer { this.alpha = alpha },
    )
}

private fun TextureView.centerCrop(video: IntSize) {
    if (width == 0 || height == 0 || video.width == 0 || video.height == 0) return
    val viewAspect = width.toFloat() / height
    val videoAspect = video.width.toFloat() / video.height
    val matrix = Matrix()
    if (videoAspect > viewAspect) {
        matrix.setScale(videoAspect / viewAspect, 1f, width / 2f, height / 2f)
    } else {
        matrix.setScale(1f, viewAspect / videoAspect, width / 2f, height / 2f)
    }
    setTransform(matrix)
}
