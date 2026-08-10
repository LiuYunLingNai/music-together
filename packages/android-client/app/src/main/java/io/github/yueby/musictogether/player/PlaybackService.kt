package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import io.github.yueby.musictogether.logging.AppLogger

@OptIn(markerClass = [UnstableApi::class])
class PlaybackService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession

    override fun onCreate() {
        super.onCreate()
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(PlaybackRequestHeaders.USER_AGENT)
        val dataSourceFactory = ResolvingDataSource.Factory(DefaultDataSource.Factory(this, httpDataSourceFactory)) { dataSpec ->
            val host = dataSpec.uri.host.orEmpty().lowercase()
            val headers = PlaybackRequestHeaders.forHost(host)
            if (headers.isNotEmpty()) {
                dataSpec.withRequestHeaders(headers)
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
        val sessionPlayer = RoomMediaSessionPlayer(player)
        mediaSession = MediaSession.Builder(this, sessionPlayer)
            .setMediaButtonPreferences(roomMediaButtonPreferences())
            .setCallback(object : MediaSession.Callback {
                override fun onPlayerCommandRequest(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    playerCommand: Int,
                ): Int {
                    val roomCommand = roomMediaCommandFor(playerCommand)
                    val isInternalMedia3Controller =
                        controller.packageName == packageName &&
                            controller.controllerVersion != MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
                    if (shouldRouteMediaCommandToRoom(roomCommand, isInternalMedia3Controller)) {
                        AppLogger.info(
                            "MediaSession",
                            "room command=$roomCommand playerCommand=$playerCommand " +
                                "package=${controller.packageName} version=${controller.controllerVersion}",
                        )
                        when (roomCommand) {
                            RoomMediaCommand.TogglePlayback -> PlaybackCommandBridge.listener?.onTogglePlayback()
                            RoomMediaCommand.Previous -> PlaybackCommandBridge.listener?.onPrevious()
                            RoomMediaCommand.Next -> PlaybackCommandBridge.listener?.onNext()
                            null -> Unit
                        }
                        return SessionError.ERROR_PERMISSION_DENIED
                    }
                    return SessionResult.RESULT_SUCCESS
                }
            })
            .build()
        AppLogger.info("MediaSession", "playback service created")
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

@OptIn(markerClass = [UnstableApi::class])
private fun roomMediaButtonPreferences(): List<CommandButton> = listOf(
    CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setPlayerCommand(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        .setDisplayName("上一首")
        .setSlots(CommandButton.SLOT_BACK)
        .build(),
    CommandButton.Builder(CommandButton.ICON_NEXT)
        .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        .setDisplayName("下一首")
        .setSlots(CommandButton.SLOT_FORWARD)
        .build(),
)
