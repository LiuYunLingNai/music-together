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

    @Test
    fun coverModeKeepsArtworkInfoAndControlsOnOneVisualAxis() {
        assertEquals(400.dp, portraitPlayerPrimaryContentWidth(400.dp, 700.dp))
        assertEquals(560.dp, portraitPlayerPrimaryContentWidth(600.dp, 900.dp))
        assertEquals(560.dp, portraitPlayerPrimaryContentWidth(760.dp, 1_100.dp))
    }

    @Test
    fun shortPortraitReducesTheAlignedContentWidthBeforeCrowdingControls() {
        assertEquals(360.dp, portraitPlayerPrimaryContentWidth(400.dp, 600.dp))
    }
}
