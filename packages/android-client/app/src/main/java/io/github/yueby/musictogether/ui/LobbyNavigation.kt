package io.github.yueby.musictogether.ui

import androidx.compose.foundation.border
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

internal enum class LobbyTab {
    Home,
    Search,
    Library,
    Recommendations,
    Settings,
}

internal object LobbyNavigationDefaults {
    val Height = 80.dp
}

@Composable
internal fun LobbyBottomNavigation(
    selectedTab: LobbyTab,
    onTabSelected: (LobbyTab) -> Unit,
    showRecommendations: Boolean,
    modifier: Modifier = Modifier,
) {
    val tabs = buildList {
        add(LobbyTab.Home)
        add(LobbyTab.Search)
        add(LobbyTab.Library)
        if (showRecommendations) add(LobbyTab.Recommendations)
        add(LobbyTab.Settings)
    }
    NavigationBar(
        modifier = modifier.border(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
        ),
        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.84f),
        tonalElevation = 0.dp,
    ) {
        tabs.forEach { tab ->
            NavigationBarItem(
                selected = tab == selectedTab,
                onClick = { onTabSelected(tab) },
                icon = {
                    Icon(
                        imageVector = when (tab) {
                            LobbyTab.Home -> Icons.Default.Home
                            LobbyTab.Search -> Icons.Default.Search
                            LobbyTab.Library -> Icons.Default.LibraryMusic
                            LobbyTab.Recommendations -> Icons.Default.AutoAwesome
                            LobbyTab.Settings -> Icons.Default.Settings
                        },
                        contentDescription = tab.label,
                    )
                },
                label = { Text(tab.label) },
            )
        }
    }
}

private val LobbyTab.label: String
    get() = when (this) {
        LobbyTab.Home -> "首页"
        LobbyTab.Search -> "搜索"
        LobbyTab.Library -> "媒体库"
        LobbyTab.Recommendations -> "推荐"
        LobbyTab.Settings -> "设置"
}
