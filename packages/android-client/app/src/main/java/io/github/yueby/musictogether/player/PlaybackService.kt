package io.github.yueby.musictogether.player

import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionResult
import io.github.yueby.musictogether.logging.AppLogger

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession

    override fun onCreate() {
        super.onCreate()
        val dataSourceFactory = ResolvingDataSource.Factory(DefaultHttpDataSource.Factory()) { dataSpec ->
            val host = dataSpec.uri.host.orEmpty().lowercase()
            if (host.endsWith(".bilivideo.com") || host.endsWith(".bilivideo.cn")) {
                dataSpec.withRequestHeaders(BILIBILI_CDN_HEADERS)
            } else {
                dataSpec
            }
        }
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .build()
            .apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    true,
                )
            }
        mediaSession = MediaSession.Builder(this, player)
            .setCallback(object : MediaSession.Callback {
                override fun onPlayerCommandRequest(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    playerCommand: Int,
                ): Int {
                    if (controller.packageName == packageName) return SessionResult.RESULT_SUCCESS
                    AppLogger.info("MediaSession", "external command=$playerCommand package=${controller.packageName}")
                    return when (playerCommand) {
                        Player.COMMAND_PLAY_PAUSE -> {
                            PlaybackCommandBridge.listener?.onTogglePlayback()
                            SessionResult.RESULT_ERROR_PERMISSION_DENIED
                        }
                        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
                            PlaybackCommandBridge.listener?.onNext()
                            SessionResult.RESULT_ERROR_PERMISSION_DENIED
                        }
                        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
                            PlaybackCommandBridge.listener?.onPrevious()
                            SessionResult.RESULT_ERROR_PERMISSION_DENIED
                        }
                        else -> SessionResult.RESULT_SUCCESS
                    }
                }
            })
            .build()
        AppLogger.info("MediaSession", "playback service created")
    }

    private companion object {
        val BILIBILI_CDN_HEADERS = mapOf(
            "Referer" to "https://www.bilibili.com/",
            "Origin" to "https://www.bilibili.com",
            "User-Agent" to "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
        )
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        if (!player.playWhenReady) stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        AppLogger.info("MediaSession", "playback service destroyed")
        mediaSession.release()
        player.release()
        super.onDestroy()
    }
}
