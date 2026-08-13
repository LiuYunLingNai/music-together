package io.github.yueby.musictogether.ui.designsystem.liquid

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class LiquidGlassNavigationBarTest {
    @Test
    fun compactIndicator_staysCircularAndNeverExceedsItsTab() {
        assertEquals(36.dp, compactDockIndicatorDiameter(36.dp))
        assertEquals(44.dp, compactDockIndicatorDiameter(48.dp))
    }
}
