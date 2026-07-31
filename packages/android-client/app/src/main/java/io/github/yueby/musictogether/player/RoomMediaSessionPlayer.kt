package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi

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
    player: Player,
) : ForwardingSimpleBasePlayer(player) {
    override fun getState(): SimpleBasePlayer.State {
        val state = super.getState()
        return state.buildUpon()
            .setAvailableCommands(withRoomTransportCommands(state.availableCommands))
            .build()
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
