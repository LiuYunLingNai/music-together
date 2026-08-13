package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.ui.graphics.Color
import io.github.yueby.musictogether.model.UiStyle
import org.junit.Assert.assertEquals
import org.junit.Test

class AppBackgroundTest {
    @Test
    fun pureBlack_isAppliedOnlyToDarkMiuix() {
        assertEquals(Color.Black, resolveAppBackgroundOverride(UiStyle.Miuix, true, true))
        assertEquals(Color.Unspecified, resolveAppBackgroundOverride(UiStyle.Miuix, false, true))
        assertEquals(Color.Unspecified, resolveAppBackgroundOverride(UiStyle.Material3, true, true))
        assertEquals(Color.Unspecified, resolveAppBackgroundOverride(UiStyle.Miuix, true, false))
    }

    @Test
    fun darkMiuixBackground_isNeverAccidentallyPureBlack() {
        assertEquals(Color.Black, resolveMiuixPageBackground(Color.Black, true, true))
        assertEquals(Color(0xFF101010), resolveMiuixPageBackground(Color.Black, true, false))
        assertEquals(Color(0xFF182030), resolveMiuixPageBackground(Color(0xFF182030), true, false))
        assertEquals(Color.White, resolveMiuixPageBackground(Color.White, false, false))
    }
}
