package io.github.yueby.musictogether.ui

import androidx.compose.runtime.Composable
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState

/** 保留 v3.0.2 设置入口约定，并交由 Material 3 与 MIUIX 共用的双风格导航渲染。 */
@Composable
internal fun LobbySettingsPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    requestedDestination: SettingsDestination?,
    onRequestedDestinationConsumed: () -> Unit,
    onNavigationDepthChanged: (Boolean) -> Unit,
) {
    SettingsNavigationPane(
        state = state,
        viewModel = viewModel,
        requestedDestination = requestedDestination,
        onRequestedDestinationConsumed = onRequestedDestinationConsumed,
        onNavigationDepthChanged = onNavigationDepthChanged,
    )
}
