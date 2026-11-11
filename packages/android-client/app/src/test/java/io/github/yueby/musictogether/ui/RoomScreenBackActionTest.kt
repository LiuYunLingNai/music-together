package io.github.yueby.musictogether.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RoomScreenBackActionTest {
    @Test
    fun `room menu is dismissed before leaving the player`() {
        assertEquals(RoomBackAction.DismissMenu, resolveRoomBackAction(roomMenuExpanded = true))
    }

    @Test
    fun `back minimizes the player when no transient content is open`() {
        assertEquals(RoomBackAction.MinimizePlayer, resolveRoomBackAction(roomMenuExpanded = false))
    }
}
