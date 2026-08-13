package io.github.yueby.musictogether.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.ui.designsystem.AppScaffold
import io.github.yueby.musictogether.ui.designsystem.AppModalBottomSheet
import io.github.yueby.musictogether.ui.player.MinimizedPlayerBar
import io.github.yueby.musictogether.ui.player.PlayerMinimizeTransitionHost

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicTogetherApp(viewModel: MusicTogetherViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val player by viewModel.playerState.collectAsStateWithLifecycle()
    val context = LocalContext.current.applicationContext
    var playerMinimized by remember(state.room?.id) { mutableStateOf(false) }
    var homeQueueVisible by remember(state.room?.id) { mutableStateOf(false) }

    LifecycleEventEffect(Lifecycle.Event.ON_START) {
        viewModel.setAppForeground(true)
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        viewModel.setAppForeground(false)
    }

    LaunchedEffect(state.error) {
        state.error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }

    LaunchedEffect(state.notice?.id) {
        state.notice?.let {
            Toast.makeText(
                context,
                it.text,
                if (it.isError) Toast.LENGTH_LONG else Toast.LENGTH_SHORT,
            ).show()
            viewModel.clearNotice()
        }
    }

    LaunchedEffect(state.hapticFeedbackEnabled) {
        syncHapticFeedbackSetting(state.hapticFeedbackEnabled)
    }

    AppScaffold { padding ->
        Box(Modifier.fillMaxSize()) {
            val showHome = state.room == null || playerMinimized
            val room = state.room
            PlayerMinimizeTransitionHost(
                roomId = room?.id,
                showHome = showHome,
                minimizedTarget = showHome && playerMinimized,
                modifier = Modifier.fillMaxSize(),
                homeContent = {
                    Box(Modifier.fillMaxSize()) {
                        LobbyScreen(
                            state = state,
                            contentPadding = padding,
                            viewModel = viewModel,
                            onOpenPlayer = { playerMinimized = false },
                            bottomAccessory = room?.takeIf { playerMinimized }?.let { activeRoom ->
                                { blurBackdrop, compact ->
                                    MinimizedPlayerBar(
                                        track = player.track ?: activeRoom.currentTrack,
                                        player = player,
                                        viewModel = viewModel,
                                        onExpand = { playerMinimized = false },
                                        onOpenQueue = { homeQueueVisible = true },
                                        blurBackdrop = blurBackdrop,
                                        compact = compact,
                                    )
                                }
                            },
                        )
                    }
                },
                playerContent = {
                    room?.let {
                        RoomScreen(
                            appState = state,
                            outerPadding = padding,
                            viewModel = viewModel,
                            onMinimizePlayer = {
                                homeQueueVisible = false
                                playerMinimized = true
                            },
                        )
                    }
                },
            )

            state.room?.takeIf { playerMinimized && homeQueueVisible }?.let { room ->
                AppModalBottomSheet(onDismissRequest = { homeQueueVisible = false }) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .fillMaxHeight(0.85f),
                    ) {
                        QueuePane(
                            room = room,
                            viewModel = viewModel,
                            onClose = { homeQueueVisible = false },
                        )
                    }
                }
            }
        }
    }
}
