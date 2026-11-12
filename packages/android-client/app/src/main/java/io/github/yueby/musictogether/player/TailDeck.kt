package io.github.yueby.musictogether.player

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * A second player that keeps the outgoing song sounding while the room's next song starts on the main player, so
 * the two can be blended for the overlap the server asked for. It never owns the media session or audio focus.
 */
@OptIn(markerClass = [UnstableApi::class])
internal class TailDeck(context: Context) {
    private val player = ExoPlayer.Builder(context)
        .setMediaSourceFactory(DefaultMediaSourceFactory(PlaybackCache.playbackFactory(context)))
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
            false,
        )
        .build()

    fun start(uri: String, cacheKey: String?, positionMs: Long, volume: Float) {
        player.volume = volume
        player.setMediaItem(
            MediaItem.Builder().setUri(Uri.parse(uri)).setCustomCacheKey(cacheKey).build(),
            positionMs,
        )
        player.prepare()
        player.play()
    }

    fun setVolume(volume: Float) {
        player.volume = volume.coerceIn(0f, 1f)
    }

    fun stop() {
        player.stop()
        player.clearMediaItems()
    }

    fun release() {
        player.release()
    }
}
