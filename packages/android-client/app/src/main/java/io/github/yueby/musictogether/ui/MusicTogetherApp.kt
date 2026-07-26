package io.github.yueby.musictogether.ui

import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel

@Composable
fun MusicTogetherApp(viewModel: MusicTogetherViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val playerState by viewModel.playerState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        if (state.room == null) {
            LobbyScreen(state, padding, viewModel)
        } else {
            RoomScreen(state, playerState, padding, viewModel)
        }
    }
}
