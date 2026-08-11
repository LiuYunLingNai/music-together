package io.github.yueby.musictogether.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class LobbyScreenBackActionTest {
    @Test
    fun `back closes local music instead of exiting the app`() {
        assertEquals(
            LobbyBackAction.CloseLocalLibrary,
            resolveLobbyBackAction(localLibraryOpen = true),
        )
    }

    @Test
    fun `back exits the app only when local music is closed`() {
        assertEquals(
            LobbyBackAction.ExitApp,
            resolveLobbyBackAction(localLibraryOpen = false),
        )
    }
}
