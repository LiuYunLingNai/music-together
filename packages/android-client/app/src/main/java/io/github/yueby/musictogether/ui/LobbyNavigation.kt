package io.github.yueby.musictogether.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.LocalBottomBarStyle
import io.github.yueby.musictogether.ui.designsystem.LocalGlassBottomBarEnabled
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import io.github.yueby.musictogether.ui.designsystem.liquid.IosLiquidGlassNavigationBar
import top.yukonga.miuix.kmp.basic.NavigationBar as MiuixNavigationBar
import top.yukonga.miuix.kmp.basic.NavigationBarItem as MiuixNavigationBarItem
import top.yukonga.miuix.kmp.basic.NavigationItem as MiuixNavigationItem
import top.yukonga.miuix.kmp.blur.LayerBackdrop

internal enum class LobbyTab {
    Home,
    Search,
    Library,
    Recommendations,
    Settings,
}

internal object LobbyNavigationDefaults {
    val StandardHeight = 80.dp
    val FloatingHeight = 64.dp
    val FloatingInsetSpacing = 8.dp
    val FloatingGestureBottomSpacing = 36.dp
    val AccessoryHeight = 64.dp
    val AccessorySpacing = 8.dp
}

internal fun floatingNavigationBottomPadding(navigationBarInset: Dp): Dp =
    if (navigationBarInset != 0.dp) {
        navigationBarInset + LobbyNavigationDefaults.FloatingInsetSpacing
    } else {
        LobbyNavigationDefaults.FloatingGestureBottomSpacing
    }

internal fun bottomDockContentHeight(
    floating: Boolean,
    hasAccessory: Boolean,
    sideBySideAccessory: Boolean = false,
    navigationBarInset: Dp = 0.dp,
    scaffoldBottomInset: Dp = 0.dp,
): Dp {
    val navigationHeight = if (floating) {
        LobbyNavigationDefaults.FloatingHeight + floatingNavigationBottomPadding(navigationBarInset)
    } else {
        LobbyNavigationDefaults.StandardHeight + scaffoldBottomInset
    }
    return navigationHeight + if (hasAccessory && !sideBySideAccessory) {
        LobbyNavigationDefaults.AccessoryHeight + LobbyNavigationDefaults.AccessorySpacing
    } else {
        0.dp
    }
}

@Composable
internal fun LobbyBottomNavigation(
    selectedTab: LobbyTab,
    onTabSelected: (LobbyTab) -> Unit,
    showRecommendations: Boolean,
    modifier: Modifier = Modifier,
    blurBackdrop: LayerBackdrop? = null,
    compact: Boolean = false,
) {
    val tabs = remember(showRecommendations) {
        buildList {
            add(LobbyTab.Home)
            add(LobbyTab.Search)
            add(LobbyTab.Library)
            if (showRecommendations) add(LobbyTab.Recommendations)
            add(LobbyTab.Settings)
        }
    }
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> NavigationBar(
            modifier = modifier.border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
            ),
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.84f),
            tonalElevation = 0.dp,
            windowInsets = WindowInsets(0),
        ) {
            tabs.forEach { tab ->
                val onHapticTabSelected = rememberHapticClick { onTabSelected(tab) }
                NavigationBarItem(
                    selected = tab == selectedTab,
                    onClick = onHapticTabSelected,
                    icon = { Icon(tab.icon, contentDescription = tab.label) },
                    label = { Text(tab.label) },
                )
            }
        }

        UiStyle.Miuix -> when (LocalBottomBarStyle.current) {
            BottomBarStyle.Standard -> MiuixNavigationBar(
                modifier = modifier.fillMaxWidth(),
                defaultWindowInsetsPadding = false,
            ) {
                tabs.forEach { tab ->
                    val onHapticTabSelected = rememberHapticClick { onTabSelected(tab) }
                    MiuixNavigationBarItem(
                        modifier = Modifier.weight(1f),
                        selected = tab == selectedTab,
                        onClick = onHapticTabSelected,
                        icon = tab.icon,
                        label = tab.label,
                    )
                }
            }

            BottomBarStyle.Floating -> {
                val hapticTabCallbacks = tabs.map { tab ->
                    rememberHapticClick { onTabSelected(tab) }
                }
                val navigationItems = remember(tabs) {
                    tabs.map { tab -> MiuixNavigationItem(label = tab.label, icon = tab.icon) }
                }
                IosLiquidGlassNavigationBar(
                    modifier = modifier,
                    items = navigationItems,
                    selectedIndex = tabs.indexOf(selectedTab).coerceAtLeast(0),
                    onItemClick = { index -> hapticTabCallbacks.getOrNull(index)?.invoke() },
                    backdrop = blurBackdrop,
                    isBlurActive = LocalGlassBottomBarEnabled.current && blurBackdrop != null,
                    compact = compact,
                )
            }
        }
    }
}

private val LobbyTab.icon: ImageVector
    get() = when (this) {
        LobbyTab.Home -> Icons.Default.Home
        LobbyTab.Search -> Icons.Default.Search
        LobbyTab.Library -> Icons.Default.LibraryMusic
        LobbyTab.Recommendations -> Icons.Default.AutoAwesome
        LobbyTab.Settings -> Icons.Default.Settings
    }

private val LobbyTab.label: String
    get() = when (this) {
        LobbyTab.Home -> "首页"
        LobbyTab.Search -> "搜索"
        LobbyTab.Library -> "媒体库"
        LobbyTab.Recommendations -> "推荐"
        LobbyTab.Settings -> "设置"
    }
