package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel

@Composable
fun MusicTogetherApp(viewModel: MusicTogetherViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_START) {
        viewModel.setAppForeground(true)
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        viewModel.setAppForeground(false)
    }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    LaunchedEffect(state.notice?.id) {
        state.notice?.let {
            snackbarHostState.showSnackbar(it.text)
            viewModel.clearNotice()
        }
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold { padding ->
            if (state.room == null) {
                LobbyScreen(state, padding, viewModel)
            } else {
                RoomScreen(state, padding, viewModel)
            }
        }
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.Center),
        )
    }
}
