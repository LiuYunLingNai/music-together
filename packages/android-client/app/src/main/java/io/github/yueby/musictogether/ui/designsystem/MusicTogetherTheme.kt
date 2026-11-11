package io.github.yueby.musictogether.ui.designsystem

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowInsetsControllerCompat
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.ThemeMode
import top.yukonga.miuix.kmp.basic.Scaffold as MiuixScaffold
import top.yukonga.miuix.kmp.theme.ColorSchemeMode
import top.yukonga.miuix.kmp.theme.LocalContentColor as MiuixLocalContentColor
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.ThemeController as MiuixThemeController

val LocalAppBlurEnabled = staticCompositionLocalOf { true }
val LocalBottomBarStyle = staticCompositionLocalOf { BottomBarStyle.Floating }
val LocalGlassBottomBarEnabled = staticCompositionLocalOf { true }
val LocalPlayerDisplaySettings = staticCompositionLocalOf { PlayerDisplaySettings() }
val LocalAppIsDark = staticCompositionLocalOf { false }
val LocalAppBackgroundColor = staticCompositionLocalOf { Color.Unspecified }
val LocalAppPageBackground = staticCompositionLocalOf { Color.Unspecified }

internal fun resolveMiuixPageBackground(
    themeBackground: Color,
    darkTheme: Boolean,
    pureBlackBackground: Boolean,
): Color = when {
    darkTheme && pureBlackBackground -> Color.Black
    darkTheme && themeBackground.red < 0.02f && themeBackground.green < 0.02f && themeBackground.blue < 0.02f ->
        Color(0xFF101010)
    else -> themeBackground
}

@Composable
fun MusicTogetherTheme(
    themeMode: ThemeMode,
    pureBlackBackground: Boolean,
    dynamicColor: Boolean,
    appBlurEnabled: Boolean,
    bottomBarStyle: BottomBarStyle,
    glassBottomBar: Boolean,
    playerDisplaySettings: PlayerDisplaySettings,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (themeMode) {
        ThemeMode.System -> systemDark
        ThemeMode.Light -> false
        ThemeMode.Dark, ThemeMode.Amoled -> true
    }
    val miuixMode = when {
        dynamicColor && themeMode == ThemeMode.System -> ColorSchemeMode.MonetSystem
        dynamicColor && !darkTheme -> ColorSchemeMode.MonetLight
        dynamicColor && darkTheme -> ColorSchemeMode.MonetDark
        themeMode == ThemeMode.System -> ColorSchemeMode.System
        !darkTheme -> ColorSchemeMode.Light
        else -> ColorSchemeMode.Dark
    }
    val miuixController = MiuixThemeController(
        colorSchemeMode = miuixMode,
        isDark = darkTheme,
    )

    LaunchedEffect(darkTheme) {
        val window = (context as? Activity)?.window ?: return@LaunchedEffect
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = !darkTheme
            isAppearanceLightNavigationBars = !darkTheme
        }
    }

    CompositionLocalProvider(
        LocalAppBlurEnabled provides appBlurEnabled,
        LocalBottomBarStyle provides bottomBarStyle,
        LocalGlassBottomBarEnabled provides glassBottomBar,
        LocalPlayerDisplaySettings provides playerDisplaySettings,
        LocalAppIsDark provides darkTheme,
    ) {
        MiuixTheme(controller = miuixController) {
            val pageBackground = resolveMiuixPageBackground(
                themeBackground = MiuixTheme.colorScheme.background,
                darkTheme = darkTheme,
                pureBlackBackground = pureBlackBackground,
            )
            val sharedContentColor = MiuixTheme.colorScheme.onBackground
            CompositionLocalProvider(
                LocalAppPageBackground provides pageBackground,
                MiuixLocalContentColor provides sharedContentColor,
                content = content,
            )
        }
    }
}

@Composable
fun AppScaffold(
    modifier: Modifier = Modifier,
    content: @Composable (PaddingValues) -> Unit,
) {
    val appBackgroundColor = LocalAppPageBackground.current
    MiuixScaffold(
        modifier = modifier,
        containerColor = if (appBackgroundColor == Color.Unspecified) MiuixTheme.colorScheme.background else appBackgroundColor,
        content = content,
    )
}
