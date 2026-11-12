package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Compass
import com.composables.icons.lucide.Disc3
import com.composables.icons.lucide.User
import com.composables.icons.lucide.Users
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.ui.designsystem.LocalBottomBarStyle
import io.github.yueby.musictogether.ui.designsystem.LocalGlassBottomBarEnabled
import io.github.yueby.musictogether.ui.designsystem.liquid.IosLiquidGlassNavigationBar
import top.yukonga.miuix.kmp.basic.NavigationBar as MiuixNavigationBar
import top.yukonga.miuix.kmp.basic.NavigationBarItem as MiuixNavigationBarItem
import top.yukonga.miuix.kmp.basic.NavigationItem as MiuixNavigationItem
import top.yukonga.miuix.kmp.blur.LayerBackdrop

internal enum class LobbyTab {
    Together,
    Discover,
    Library,
    Me,
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
    modifier: Modifier = Modifier,
    blurBackdrop: LayerBackdrop? = null,
    compact: Boolean = false,
) {
    val tabs = remember { LobbyTab.entries.toList() }
    when (LocalBottomBarStyle.current) {
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

private val LobbyTab.icon: ImageVector
    get() = when (this) {
        LobbyTab.Together -> Lucide.Users
        LobbyTab.Discover -> Lucide.Compass
        LobbyTab.Library -> Lucide.Disc3
        LobbyTab.Me -> Lucide.User
    }

private val LobbyTab.label: String
    get() = when (this) {
        LobbyTab.Together -> "一起听"
        LobbyTab.Discover -> "发现"
        LobbyTab.Library -> "媒体库"
        LobbyTab.Me -> "我的"
    }
