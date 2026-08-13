package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Test

class UiStyleTest {
    @Test
    fun preferenceValue_roundTripsEveryStyle() {
        UiStyle.entries.forEach { style ->
            assertEquals(style, UiStyle.fromPreferenceValue(style.preferenceValue))
        }
    }

    @Test
    fun missingOrUnknownPreference_fallsBackToMaterial3() {
        assertEquals(UiStyle.Material3, UiStyle.fromPreferenceValue(null))
        assertEquals(UiStyle.Material3, UiStyle.fromPreferenceValue("unknown"))
    }

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
    fun floatingBottomBar_isMiuixOnly() {
        assertEquals(false, UiStyle.Material3.usesFloatingBottomBar(BottomBarStyle.Floating))
        assertEquals(false, UiStyle.Material3.usesFloatingBottomBar(BottomBarStyle.Standard))
        assertEquals(false, UiStyle.Miuix.usesFloatingBottomBar(BottomBarStyle.Standard))
        assertEquals(true, UiStyle.Miuix.usesFloatingBottomBar(BottomBarStyle.Floating))
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
