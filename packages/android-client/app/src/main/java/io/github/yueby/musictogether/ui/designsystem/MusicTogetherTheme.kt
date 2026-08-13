package io.github.yueby.musictogether.ui.designsystem

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.LocalContentColor as MaterialLocalContentColor
import androidx.compose.material3.Scaffold as MaterialScaffold
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
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
import io.github.yueby.musictogether.model.UiStyle
import top.yukonga.miuix.kmp.basic.Scaffold as MiuixScaffold
import top.yukonga.miuix.kmp.theme.ColorSchemeMode
import top.yukonga.miuix.kmp.theme.LocalContentColor as MiuixLocalContentColor
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.ThemeController as MiuixThemeController

val LocalUiStyle = staticCompositionLocalOf { UiStyle.Material3 }
val LocalAppBlurEnabled = staticCompositionLocalOf { true }
val LocalBottomBarStyle = staticCompositionLocalOf { BottomBarStyle.Floating }
val LocalGlassBottomBarEnabled = staticCompositionLocalOf { true }
val LocalPlayerDisplaySettings = staticCompositionLocalOf { PlayerDisplaySettings() }
val LocalAppIsDark = staticCompositionLocalOf { false }
val LocalAppBackgroundColor = staticCompositionLocalOf { Color.Unspecified }
val LocalAppPageBackground = staticCompositionLocalOf { Color.Unspecified }

internal fun resolveAppBackgroundOverride(
    uiStyle: UiStyle,
    darkTheme: Boolean,
    pureBlackBackground: Boolean,
): Color = if (uiStyle == UiStyle.Miuix && darkTheme && pureBlackBackground) Color.Black else Color.Unspecified

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
    uiStyle: UiStyle,
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
    val appBackgroundColor = resolveAppBackgroundOverride(uiStyle, darkTheme, pureBlackBackground)
    val materialColors = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> darkColorScheme()
        else -> lightColorScheme()
    }.let { colors ->
        if (themeMode == ThemeMode.Amoled) {
            colors.copy(
                background = Color.Black,
                surface = Color.Black,
                surfaceDim = Color.Black,
                surfaceBright = Color(0xFF1A1A1A),
                surfaceContainerLowest = Color.Black,
                surfaceContainerLow = Color(0xFF080808),
                surfaceContainer = Color(0xFF101010),
                surfaceContainerHigh = Color(0xFF171717),
                surfaceContainerHighest = Color(0xFF202020),
            )
        } else {
            colors
        }
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
        LocalUiStyle provides uiStyle,
        LocalAppBlurEnabled provides appBlurEnabled,
        LocalBottomBarStyle provides bottomBarStyle,
        LocalGlassBottomBarEnabled provides glassBottomBar,
        LocalPlayerDisplaySettings provides playerDisplaySettings,
        LocalAppIsDark provides darkTheme,
        LocalAppBackgroundColor provides appBackgroundColor,
    ) {
        MiuixTheme(controller = miuixController) {
            val pageBackground = if (uiStyle == UiStyle.Miuix) {
                resolveMiuixPageBackground(
                    themeBackground = MiuixTheme.colorScheme.background,
                    darkTheme = darkTheme,
                    pureBlackBackground = pureBlackBackground,
                )
            } else {
                materialColors.background
            }
            val effectiveMaterialColors = if (uiStyle == UiStyle.Miuix) {
                materialColors.copy(
                    primary = MiuixTheme.colorScheme.primary,
                    onPrimary = MiuixTheme.colorScheme.onPrimary,
                    primaryContainer = MiuixTheme.colorScheme.primaryContainer,
                    onPrimaryContainer = MiuixTheme.colorScheme.onPrimaryContainer,
                    secondary = MiuixTheme.colorScheme.secondary,
                    onSecondary = MiuixTheme.colorScheme.onSecondary,
                    secondaryContainer = MiuixTheme.colorScheme.secondaryContainer,
                    onSecondaryContainer = MiuixTheme.colorScheme.onSecondaryContainer,
                    background = pageBackground,
                    onBackground = MiuixTheme.colorScheme.onBackground,
                    surface = MiuixTheme.colorScheme.surface,
                    onSurface = MiuixTheme.colorScheme.onSurface,
                    surfaceVariant = MiuixTheme.colorScheme.surfaceVariant,
                    onSurfaceVariant = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    surfaceContainer = MiuixTheme.colorScheme.surfaceContainer,
                    surfaceContainerHigh = MiuixTheme.colorScheme.surfaceContainerHigh,
                    surfaceContainerHighest = MiuixTheme.colorScheme.surfaceContainerHighest,
                    outline = MiuixTheme.colorScheme.outline,
                    outlineVariant = MiuixTheme.colorScheme.dividerLine,
                    error = MiuixTheme.colorScheme.error,
                    onError = MiuixTheme.colorScheme.onError,
                    errorContainer = MiuixTheme.colorScheme.errorContainer,
                    onErrorContainer = MiuixTheme.colorScheme.onErrorContainer,
                )
            } else {
                materialColors
            }
            val effectiveMaterialTypography = if (uiStyle == UiStyle.Miuix) {
                Typography(
                    displayLarge = MiuixTheme.textStyles.title1,
                    displayMedium = MiuixTheme.textStyles.title1,
                    displaySmall = MiuixTheme.textStyles.title1,
                    headlineLarge = MiuixTheme.textStyles.headline1,
                    headlineMedium = MiuixTheme.textStyles.headline1,
                    headlineSmall = MiuixTheme.textStyles.headline2,
                    titleLarge = MiuixTheme.textStyles.title2,
                    titleMedium = MiuixTheme.textStyles.title3,
                    titleSmall = MiuixTheme.textStyles.title4,
                    bodyLarge = MiuixTheme.textStyles.body1,
                    bodyMedium = MiuixTheme.textStyles.body2,
                    bodySmall = MiuixTheme.textStyles.paragraph,
                    labelLarge = MiuixTheme.textStyles.button,
                    labelMedium = MiuixTheme.textStyles.footnote1,
                    labelSmall = MiuixTheme.textStyles.footnote2,
                )
            } else {
                Typography()
            }
            CompositionLocalProvider(LocalAppPageBackground provides pageBackground) {
                MaterialTheme(
                    colorScheme = effectiveMaterialColors,
                    typography = effectiveMaterialTypography,
                ) {
                    val sharedContentColor = when (uiStyle) {
                        UiStyle.Material3 -> MaterialTheme.colorScheme.onBackground
                        UiStyle.Miuix -> MiuixTheme.colorScheme.onBackground
                    }
                    CompositionLocalProvider(
                        MaterialLocalContentColor provides sharedContentColor,
                        MiuixLocalContentColor provides sharedContentColor,
                        content = content,
                    )
                }
            }
        }
    }
}

@Composable
fun AppScaffold(
    modifier: Modifier = Modifier,
    content: @Composable (PaddingValues) -> Unit,
) {
    val appBackgroundColor = LocalAppPageBackground.current
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialScaffold(modifier = modifier, content = content)
        UiStyle.Miuix -> MiuixScaffold(
            modifier = modifier,
            containerColor = if (appBackgroundColor == Color.Unspecified) MiuixTheme.colorScheme.background else appBackgroundColor,
            content = content,
        )
    }
}
