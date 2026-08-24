package io.github.yueby.musictogether

import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.yueby.musictogether.ui.MusicTogetherApp
import io.github.yueby.musictogether.ui.designsystem.MusicTogetherTheme
import io.github.yueby.musictogether.logging.AppLogger

class MainActivity : ComponentActivity() {
    private var roomLinkHandler: ((String) -> Unit)? = null
    private var pendingRoomLink: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppLogger.initialize(applicationContext)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        enableEdgeToEdge()
        setContent {
            val viewModel: MusicTogetherViewModel = viewModel()
            val state = viewModel.state.collectAsStateWithLifecycle()
            DisposableEffect(viewModel) {
                roomLinkHandler = viewModel::handleExternalRoomLink
                pendingRoomLink?.let { link ->
                    pendingRoomLink = null
                    viewModel.handleExternalRoomLink(link)
                }
                onDispose {
                    roomLinkHandler = null
                }
            }
            LaunchedEffect(viewModel) {
                intent?.dataString?.let(viewModel::handleExternalRoomLink)
                setIntent(Intent())
            }
            MusicTogetherTheme(
                uiStyle = state.value.uiStyle,
                themeMode = state.value.themeMode,
                pureBlackBackground = state.value.pureBlackBackground,
                dynamicColor = state.value.dynamicColor,
                appBlurEnabled = state.value.appBlurEnabled,
                bottomBarStyle = state.value.bottomBarStyle,
                glassBottomBar = state.value.glassBottomBar,
                playerDisplaySettings = state.value.playerDisplaySettings,
            ) {
                MusicTogetherApp(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val link = intent.dataString ?: return
        roomLinkHandler?.invoke(link) ?: run { pendingRoomLink = link }
    }
}
