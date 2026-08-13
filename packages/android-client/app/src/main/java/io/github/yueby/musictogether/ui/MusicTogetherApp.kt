package io.github.yueby.musictogether.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
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

    Scaffold { padding ->
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
                            bottomContentPadding = if (playerMinimized) 76.dp else 0.dp,
                            onOpenPlayer = { playerMinimized = false },
                        )
                        room?.takeIf { playerMinimized }?.let { activeRoom ->
                            MinimizedPlayerBar(
                                track = player.track ?: activeRoom.currentTrack,
                                player = player,
                                viewModel = viewModel,
                                onExpand = { playerMinimized = false },
                                onOpenQueue = { homeQueueVisible = true },
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(
                                        bottom = padding.calculateBottomPadding() + LobbyNavigationDefaults.Height,
                                    ),
                            )
                        }
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
                ModalBottomSheet(onDismissRequest = { homeQueueVisible = false }) {
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
