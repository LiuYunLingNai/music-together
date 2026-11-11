package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.designsystem.LocalAppBlurEnabled
import io.github.yueby.musictogether.ui.designsystem.LocalAppPageBackground
import io.github.yueby.musictogether.ui.designsystem.LocalBottomBarStyle
import io.github.yueby.musictogether.ui.designsystem.LocalGlassBottomBarEnabled
import io.github.yueby.musictogether.ui.designsystem.rememberAppBlurBackdrop
import io.github.yueby.musictogether.model.usesFloatingBottomBar
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.layerBackdrop

@Composable
internal fun MainTabsScreen(
    state: AppState,
    contentPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    shellOnTop: Boolean,
    onOpenPlayer: (() -> Unit)?,
    bottomAccessory: (@Composable (LayerBackdrop?, Boolean) -> Unit)?,
) {
    var selectedTab by rememberSaveable { mutableStateOf(LobbyTab.Together) }
    val tabStates = rememberSaveableStateHolder()
    val floatingBar = usesFloatingBottomBar(LocalBottomBarStyle.current)
    val navigationBarInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val blurBackdrop = rememberAppBlurBackdrop(
        enabled = floatingBar && LocalAppBlurEnabled.current && LocalGlassBottomBarEnabled.current,
    )
    val sideBySideDock = floatingBar && bottomAccessory != null
    val dockHeight = bottomDockContentHeight(
        floating = floatingBar,
        hasAccessory = bottomAccessory != null,
        sideBySideAccessory = sideBySideDock,
        navigationBarInset = navigationBarInset,
        scaffoldBottomInset = contentPadding.calculateBottomPadding(),
    )
    val selectTab: (LobbyTab) -> Unit = { selectedTab = it }

    BackHandler(enabled = shellOnTop && selectedTab != LobbyTab.Together) { selectedTab = LobbyTab.Together }

    Box(Modifier.fillMaxSize().background(LocalAppPageBackground.current)) {
        Box(
            Modifier
                .fillMaxSize()
                .then(if (blurBackdrop != null) Modifier.layerBackdrop(blurBackdrop) else Modifier),
        ) {
            AnimatedContent(
                targetState = selectedTab,
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
                label = "tab",
            ) { tab ->
                tabStates.SaveableStateProvider(tab.name) {
                    when (tab) {
                        LobbyTab.Together -> TogetherTab(state, viewModel, dockHeight, onOpenPlayer)
                        LobbyTab.Discover -> DiscoverTab(state, viewModel, dockHeight)
                        LobbyTab.Library -> LibraryTab(state, viewModel, dockHeight)
                        LobbyTab.Me -> MeTab(state, viewModel, dockHeight)
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(dockHeight),
        ) {
            if (sideBySideDock) {
                val compactAccessory = requireNotNull(bottomAccessory)
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 12.dp, bottom = floatingNavigationBottomPadding(navigationBarInset))
                        .height(LobbyNavigationDefaults.FloatingHeight),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f).fillMaxHeight()) { compactAccessory(blurBackdrop, true) }
                    LobbyBottomNavigation(
                        selectedTab = selectedTab,
                        onTabSelected = selectTab,
                        modifier = Modifier.weight(1f),
                        blurBackdrop = blurBackdrop,
                        compact = true,
                    )
                }
            } else {
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                    bottomAccessory?.let { accessory ->
                        Box(Modifier.fillMaxWidth().height(LobbyNavigationDefaults.AccessoryHeight)) {
                            accessory(blurBackdrop, false)
                        }
                        Spacer(Modifier.height(LobbyNavigationDefaults.AccessorySpacing))
                    }
                    LobbyBottomNavigation(
                        selectedTab = selectedTab,
                        onTabSelected = selectTab,
                        blurBackdrop = blurBackdrop,
                    )
                }
            }
        }
    }
}
