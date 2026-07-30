package io.github.yueby.musictogether.ui.player

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class PortraitPlayerLayoutTest {
    @Test
    fun compactPortraitUsesTheFullAvailableWidth() {
        assertEquals(400.dp, portraitPlayerContentWidth(400.dp))
        assertEquals(600.dp, portraitPlayerContentWidth(600.dp))
    }

    @Test
    fun tabletPortraitWidensAndCentersThePlayerContent() {
        assertEquals(680.dp, portraitPlayerContentWidth(700.dp))
        assertEquals(760.dp, portraitPlayerContentWidth(800.dp))
    }

    @Test
    fun expandedPortraitKeepsALegibleMaximumWidth() {
        assertEquals(760.dp, portraitPlayerContentWidth(1_200.dp))
    }
}
