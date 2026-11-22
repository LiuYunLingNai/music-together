package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

internal val roomTransportCommands = intArrayOf(
    Player.COMMAND_SEEK_TO_PREVIOUS,
    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
    Player.COMMAND_SEEK_TO_NEXT,
    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
)

/**
 * A room has a server-owned queue even though ExoPlayer only contains the currently playing item.
 * Advertise the room transport controls so system controllers do not mistake it for a one-item queue.
 */
@OptIn(markerClass = [UnstableApi::class])
internal class RoomMediaSessionPlayer(
    private val delegatePlayer: Player,
    private val onExternalPlayback: (Boolean) -> Boolean,
    private val onExternalSeek: (Long) -> Boolean,
) : ForwardingSimpleBasePlayer(delegatePlayer) {
    override fun getState(): SimpleBasePlayer.State {
        val state = super.getState()
        return state.buildUpon()
            .setAvailableCommands(withRoomTransportCommands(state.availableCommands))
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        if (onExternalPlayback(playWhenReady)) return Futures.immediateVoidFuture()
        return super.handleSetPlayWhenReady(playWhenReady)
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val target = when (seekCommand) {
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_MEDIA_ITEM -> positionMs
            Player.COMMAND_SEEK_TO_DEFAULT_POSITION -> 0L
            Player.COMMAND_SEEK_BACK -> delegatePlayer.currentPosition - delegatePlayer.seekBackIncrement
            Player.COMMAND_SEEK_FORWARD -> delegatePlayer.currentPosition + delegatePlayer.seekForwardIncrement
            else -> return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
        }
        if (onExternalSeek(target.coerceAtLeast(0))) return Futures.immediateVoidFuture()
        return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
    }
}

@OptIn(markerClass = [UnstableApi::class])
internal fun withRoomTransportCommands(commands: Player.Commands): Player.Commands =
    commands.buildUpon()
        .addAll(*roomTransportCommands)
        .build()

internal enum class RoomMediaCommand {
    TogglePlayback,
    Previous,
    Next,
}

internal fun roomMediaCommandFor(playerCommand: Int): RoomMediaCommand? = when (playerCommand) {
    Player.COMMAND_PLAY_PAUSE -> RoomMediaCommand.TogglePlayback
    Player.COMMAND_SEEK_TO_PREVIOUS,
    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
    -> RoomMediaCommand.Previous
    Player.COMMAND_SEEK_TO_NEXT,
    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
    -> RoomMediaCommand.Next
    else -> null
}

internal fun shouldRouteMediaCommandToRoom(
    command: RoomMediaCommand?,
    isInternalMedia3Controller: Boolean,
): Boolean = when (command) {
    RoomMediaCommand.Previous,
    RoomMediaCommand.Next,
    -> true
    RoomMediaCommand.TogglePlayback -> !isInternalMedia3Controller
    null -> false
}
