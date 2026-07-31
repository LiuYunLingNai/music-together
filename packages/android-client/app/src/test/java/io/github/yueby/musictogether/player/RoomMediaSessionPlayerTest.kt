package io.github.yueby.musictogether.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomMediaSessionPlayerTest {
    @Test
    fun `maps both previous command variants to room previous`() {
        assertEquals(
            RoomMediaCommand.Previous,
            roomMediaCommandFor(Player.COMMAND_SEEK_TO_PREVIOUS),
        )
        assertEquals(
            RoomMediaCommand.Previous,
            roomMediaCommandFor(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM),
        )
    }

    @Test
    fun `maps both next command variants to room next`() {
        assertEquals(
            RoomMediaCommand.Next,
            roomMediaCommandFor(Player.COMMAND_SEEK_TO_NEXT),
        )
        assertEquals(
            RoomMediaCommand.Next,
            roomMediaCommandFor(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM),
        )
    }

    @Test
    fun `keeps playback toggle and ignores unrelated commands`() {
        assertEquals(
            RoomMediaCommand.TogglePlayback,
            roomMediaCommandFor(Player.COMMAND_PLAY_PAUSE),
        )
        assertNull(roomMediaCommandFor(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM))
    }

    @Test
    fun `routes legacy playback toggle without intercepting internal media3 playback`() {
        assertEquals(
            true,
            shouldRouteMediaCommandToRoom(
                command = RoomMediaCommand.TogglePlayback,
                isInternalMedia3Controller = false,
            ),
        )
        assertEquals(
            false,
            shouldRouteMediaCommandToRoom(
                command = RoomMediaCommand.TogglePlayback,
                isInternalMedia3Controller = true,
            ),
        )
    }

    @Test
    fun `always routes room track changes`() {
        assertEquals(
            true,
            shouldRouteMediaCommandToRoom(
                command = RoomMediaCommand.Previous,
                isInternalMedia3Controller = true,
            ),
        )
        assertEquals(
            true,
            shouldRouteMediaCommandToRoom(
                command = RoomMediaCommand.Next,
                isInternalMedia3Controller = false,
            ),
        )
    }
}
