package io.github.yueby.musictogether.ui

import android.widget.Toast
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel

@Composable
fun MusicTogetherApp(viewModel: MusicTogetherViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current.applicationContext

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

    Scaffold { padding ->
        if (state.room == null) {
            LobbyScreen(state, padding, viewModel)
        } else {
            RoomScreen(state, padding, viewModel)
        }
    }
}
