package io.github.yueby.musictogether.player

import android.media.audiofx.Equalizer
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import io.github.yueby.musictogether.logging.AppLogger

@OptIn(markerClass = [UnstableApi::class])
class PlaybackService : MediaSessionService() {
    private lateinit var decks: PlaybackDecks
    private lateinit var mediaSession: MediaSession
    private var equalizers: List<Equalizer> = emptyList()
    private var equalizerSessions: List<Int> = emptyList()
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .build()

    override fun onCreate() {
        super.onCreate()
        fun externalController(): Boolean {
            val controller = mediaSession.controllerForCurrentRequest ?: return false
            return controller.packageName != packageName ||
                controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
        }
        decks = PlaybackDecks(this, onHandOver = { mediaSession.player = it },
            onExternalPlayback = { playing ->
                val external = externalController()
                if (external) PlaybackCommandBridge.listener?.onPlaybackRequested(playing)
                external
            },
            onExternalSeek = { positionMs ->
                val external = externalController()
                if (external) decks.active.player.currentMediaItem?.mediaId?.let {
                    PlaybackCommandBridge.listener?.onSeek(it, positionMs / 1_000.0)
                }
                external
            },
        )
        PlaybackCommandBridge.decks = decks
        configureAudioFocus(PlaybackCommandBridge.audioFocusEnabled)
        PlaybackCommandBridge.audioFocusListener = ::configureAudioFocus
        configureEqualizer(PlaybackCommandBridge.equalizerEnabled, PlaybackCommandBridge.equalizerPreset)
        PlaybackCommandBridge.equalizerListener = ::configureEqualizer
        mediaSession = MediaSession.Builder(this, decks.active.sessionPlayer)
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
                    if (roomCommand != RoomMediaCommand.TogglePlayback &&
                        shouldRouteMediaCommandToRoom(roomCommand, isInternalMedia3Controller)) {
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
        if (!decks.active.player.playWhenReady) stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        AppLogger.info("MediaSession", "playback service destroyed")
        PlaybackCommandBridge.audioFocusListener = null
        PlaybackCommandBridge.equalizerListener = null
        PlaybackCommandBridge.decks = null
        equalizers.forEach { runCatching { it.release() } }
        equalizers = emptyList()
        mediaSession.release()
        decks.release()
        super.onDestroy()
    }

    /** System equalizer, one per deck session so both songs of a transition are shaped; presets come from the device. */
    private fun configureEqualizer(enabled: Boolean, preset: Int) {
        runCatching {
            if (!enabled) {
                equalizers.forEach { it.enabled = false }
                return
            }
            val sessions = decks.audioSessionIds
            if (sessions != equalizerSessions) {
                equalizers.forEach { runCatching { it.release() } }
                equalizers = sessions.map { Equalizer(0, it) }
                equalizerSessions = sessions
            }
            equalizers.forEachIndexed { index, effect ->
                val count = effect.numberOfPresets.toInt()
                if (index == 0) {
                    PlaybackCommandBridge.equalizerPresets = (0 until count).map { effect.getPresetName(it.toShort()) }
                }
                if (count > 0) effect.usePreset(preset.coerceIn(0, count - 1).toShort())
                effect.enabled = true
            }
        }.onFailure { AppLogger.error("Player", "equalizer unavailable", it) }
    }

    private fun configureAudioFocus(enabled: Boolean) {
        decks.configureAudioFocus(audioAttributes, enabled)
        AppLogger.info("Player", "audio focus enabled=$enabled")
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
