package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Status colours Miuix has no token for; each follows the light/dark scheme. */
object AppSemanticColors {
    val online: Color
        @Composable get() = if (LocalAppIsDark.current) Color(0xFF4ADE80) else Color(0xFF16A34A)

    val owner: Color
        @Composable get() = if (LocalAppIsDark.current) Color(0xFFFFC857) else Color(0xFFD97706)
}
