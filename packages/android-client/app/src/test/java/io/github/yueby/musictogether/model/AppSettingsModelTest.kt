package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Test

class AppSettingsModelTest {
    @Test
    fun themeMode_roundTripsAndFallsBackToSystem() {
        ThemeMode.entries.forEach { mode ->
            assertEquals(mode, ThemeMode.fromPreferenceValue(mode.preferenceValue))
        }
        assertEquals(ThemeMode.System, ThemeMode.fromPreferenceValue("unknown"))
    }

    @Test
    fun bottomBarStyle_roundTripsAndFallsBackToFloating() {
        BottomBarStyle.entries.forEach { style ->
            assertEquals(style, BottomBarStyle.fromPreferenceValue(style.preferenceValue))
        }
        assertEquals(BottomBarStyle.Floating, BottomBarStyle.fromPreferenceValue(null))
    }

    @Test
    fun floatingBottomBar_isUsedForFloatingBottomBarOnly() {
        assertEquals(true, usesFloatingBottomBar(BottomBarStyle.Floating))
        assertEquals(false, usesFloatingBottomBar(BottomBarStyle.Standard))
    }

    @Test
    fun playerDisplaySettings_normalizesPersistedRanges() {
        val normalized = PlayerDisplaySettings(
            lyricFontScale = 2f,
            lyricFontWeight = 100,
            lyricAlignPosition = -1f,
            backgroundMotionStrength = 3f,
        ).normalized()

        assertEquals(1.3f, normalized.lyricFontScale)
        assertEquals(400, normalized.lyricFontWeight)
        assertEquals(0.05f, normalized.lyricAlignPosition)
        assertEquals(1.5f, normalized.backgroundMotionStrength)
    }
}
