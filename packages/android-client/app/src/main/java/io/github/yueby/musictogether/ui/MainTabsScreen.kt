package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import io.github.yueby.musictogether.ui.designsystem.liquid.liquidGlassSurface
import kotlin.math.roundToInt
import kotlin.math.sign
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.theme.MiuixTheme
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
private fun DockTabButton(
    tab: LobbyTab,
    blurBackdrop: LayerBackdrop?,
    progress: () -> Float,
    onClick: () -> Unit,
) {
    val shape = CircleShape
    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                val shown = progress().coerceIn(0f, 1.1f)
                alpha = ((shown - 0.3f) / 0.7f).coerceIn(0f, 1f)
                val scale = 0.7f + 0.3f * shown
                scaleX = scale
                scaleY = scale
            }
            .liquidGlassSurface(blurBackdrop, shape)
            .clip(shape)
            .clickable(onClick = rememberHapticClick(onClick)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(tab.icon, contentDescription = "展开导航，当前${tab.label}", tint = MiuixTheme.colorScheme.primary)
    }
}

@Composable
internal fun MainTabsScreen(
    state: AppState,
    contentPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    shellOnTop: Boolean,
    onOpenPlayer: (() -> Unit)?,
    bottomAccessory: (@Composable (LayerBackdrop?) -> Unit)?,
) {
    var selectedTab by rememberSaveable { mutableStateOf(LobbyTab.Together) }
    val tabStates = rememberSaveableStateHolder()
    val floatingBar = usesFloatingBottomBar(LocalBottomBarStyle.current)
    val navigationBarInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val blurBackdrop = rememberAppBlurBackdrop(
        enabled = floatingBar && LocalAppBlurEnabled.current && LocalGlassBottomBarEnabled.current,
    )
    // Floating dock: the player sits above the tabs at rest; scrolling the page folds the tabs into one
    // button and lets the player drop into their row.
    val collapsibleDock = floatingBar && bottomAccessory != null
    var dockCollapsed by remember { mutableStateOf(false) }
    LaunchedEffect(selectedTab, collapsibleDock) { dockCollapsed = false }
    val dockCollapse by animateFloatAsState(
        targetValue = if (dockCollapsed && collapsibleDock) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 320f),
        label = "dock-collapse",
    )
    val collapseThresholdPx = with(LocalDensity.current) { 24.dp.toPx() }
    val scrollWatcher = remember(collapseThresholdPx) {
        object : NestedScrollConnection {
            var travelled = 0f

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                val moved = consumed.y
                if (moved == 0f) return Offset.Zero
                if (moved.sign != travelled.sign) travelled = 0f
                travelled += moved
                if (travelled < -collapseThresholdPx) dockCollapsed = true
                if (travelled > collapseThresholdPx) dockCollapsed = false
                return Offset.Zero
            }
        }
    }
    val dockHeight = bottomDockContentHeight(
        floating = floatingBar,
        hasAccessory = bottomAccessory != null,
        navigationBarInset = navigationBarInset,
        scaffoldBottomInset = contentPadding.calculateBottomPadding(),
    )
    val selectTab: (LobbyTab) -> Unit = { selectedTab = it }

    BackHandler(enabled = shellOnTop && selectedTab != LobbyTab.Together) { selectedTab = LobbyTab.Together }

    Box(Modifier.fillMaxSize().background(LocalAppPageBackground.current)) {
        Box(
            Modifier
                .fillMaxSize()
                .nestedScroll(scrollWatcher)
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
            if (collapsibleDock) {
                val accessory = requireNotNull(bottomAccessory)
                Layout(
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                    content = {
                        Box(
                            Modifier.graphicsLayer {
                                alpha = (1f - dockCollapse * 1.6f).coerceIn(0f, 1f)
                                val scale = 1f - 0.08f * dockCollapse.coerceIn(0f, 1f)
                                scaleX = scale
                                scaleY = scale
                                transformOrigin = TransformOrigin(0f, 0.5f)
                            },
                        ) {
                            LobbyBottomNavigation(
                                selectedTab = selectedTab,
                                onTabSelected = selectTab,
                                blurBackdrop = blurBackdrop,
                            )
                        }
                        Box {
                            if (dockCollapsed || dockCollapse > 0.01f) {
                                DockTabButton(
                                    tab = selectedTab,
                                    blurBackdrop = blurBackdrop,
                                    progress = { dockCollapse },
                                    onClick = { dockCollapsed = false },
                                )
                            }
                        }
                        Box { accessory(blurBackdrop) }
                    },
                ) { measurables, constraints ->
                    val row = LobbyNavigationDefaults.AccessoryHeight.roundToPx()
                    val step = row + LobbyNavigationDefaults.AccessorySpacing.roundToPx()
                    val shift = (step * dockCollapse.coerceAtLeast(0f)).roundToInt()
                    val navigation = measurables[0].measure(constraints.copy(minHeight = 0))
                    val button = measurables[1].measure(Constraints.fixed(row, row))
                    val player = measurables[2].measure(
                        Constraints.fixed((constraints.maxWidth - shift).coerceAtLeast(0), row),
                    )
                    layout(constraints.maxWidth, step + navigation.height) {
                        navigation.place(0, step)
                        button.place(24.dp.roundToPx(), step)
                        player.place(shift, shift)
                    }
                }
            } else {
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                    bottomAccessory?.let { accessory ->
                        Box(Modifier.fillMaxWidth().height(LobbyNavigationDefaults.AccessoryHeight)) {
                            accessory(blurBackdrop)
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
