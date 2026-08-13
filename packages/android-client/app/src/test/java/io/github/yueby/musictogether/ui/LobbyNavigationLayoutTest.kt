package io.github.yueby.musictogether.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class LobbyNavigationLayoutTest {
    @Test
    fun floatingDock_reservesNavigationAccessoryAndGap() {
        assertEquals(100.dp, bottomDockContentHeight(floating = true, hasAccessory = false))
        assertEquals(172.dp, bottomDockContentHeight(floating = true, hasAccessory = true))
        assertEquals(
            100.dp,
            bottomDockContentHeight(
                floating = true,
                hasAccessory = true,
                sideBySideAccessory = true,
            ),
        )
        assertEquals(
            96.dp,
            bottomDockContentHeight(
                floating = true,
                hasAccessory = false,
                navigationBarInset = 24.dp,
            ),
        )
    }

    @Test
    fun standardDock_reservesNavigationAccessoryAndGap() {
        assertEquals(80.dp, bottomDockContentHeight(floating = false, hasAccessory = false))
        assertEquals(152.dp, bottomDockContentHeight(floating = false, hasAccessory = true))
        assertEquals(
            104.dp,
            bottomDockContentHeight(
                floating = false,
                hasAccessory = false,
                scaffoldBottomInset = 24.dp,
            ),
        )
    }
}
