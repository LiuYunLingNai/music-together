package io.github.yueby.musictogether.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RoomScreenBackActionTest {
    @Test
    fun `active overlay is dismissed before leaving the player`() {
        assertEquals(
            RoomBackAction.DismissOverlay,
            resolveRoomBackAction(hasActiveOverlay = true, roomMenuExpanded = false),
        )
    }

    @Test
    fun `room menu is dismissed before leaving the player`() {
        assertEquals(
            RoomBackAction.DismissMenu,
            resolveRoomBackAction(hasActiveOverlay = false, roomMenuExpanded = true),
        )
    }

    @Test
    fun `back minimizes the player when no transient content is open`() {
        assertEquals(
            RoomBackAction.MinimizePlayer,
            resolveRoomBackAction(hasActiveOverlay = false, roomMenuExpanded = false),
        )
    }
}
