package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class AppBackgroundTest {
    @Test
    fun darkMiuixBackground_isNeverAccidentallyPureBlack() {
        assertEquals(Color.Black, resolveMiuixPageBackground(Color.Black, true, true))
        assertEquals(Color(0xFF101010), resolveMiuixPageBackground(Color.Black, true, false))
        assertEquals(Color(0xFF182030), resolveMiuixPageBackground(Color(0xFF182030), true, false))
        assertEquals(Color.White, resolveMiuixPageBackground(Color.White, false, false))
    }
}
