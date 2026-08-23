package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import io.github.yueby.musictogether.ui.designsystem.AppModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import io.github.yueby.musictogether.ui.player.PlayerPane
import kotlinx.coroutines.delay
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton

internal enum class RoomOverlay {
    Queue, Search, Recommendations, Download, Chat, Members, Accounts, AccountSettings, RoomSettings
}

private val RoomOverlay.title: String
    get() = when (this) {
        RoomOverlay.Queue -> "播放队列"
        RoomOverlay.Search -> "搜索点歌"
        RoomOverlay.Recommendations -> "推荐点歌"
        RoomOverlay.Download -> "下载歌曲"
        RoomOverlay.Chat -> "房间聊天"
        RoomOverlay.Members -> "房间成员"
        RoomOverlay.Accounts -> "平台账号与歌单"
        RoomOverlay.AccountSettings -> "个人账号"
        RoomOverlay.RoomSettings -> "房间与音质"
    }

internal enum class RoomBackAction {
    DismissOverlay,
    DismissMenu,
    MinimizePlayer,
}

internal fun resolveRoomBackAction(
    hasActiveOverlay: Boolean,
    roomMenuExpanded: Boolean,
): RoomBackAction =
    when {
        hasActiveOverlay -> RoomBackAction.DismissOverlay
        roomMenuExpanded -> RoomBackAction.DismissMenu
        else -> RoomBackAction.MinimizePlayer
    }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    appState: AppState,
    outerPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    onMinimizePlayer: () -> Unit,
) {
    val room = appState.room ?: return
    var activeOverlay by remember { mutableStateOf<RoomOverlay?>(null) }
    var landscapeChromeVisible by remember(room.id) { mutableStateOf(true) }
    var roomMenuExpanded by remember(room.id) { mutableStateOf(false) }
    val overlaySheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val handleBack = {
        when (resolveRoomBackAction(activeOverlay != null, roomMenuExpanded)) {
            RoomBackAction.DismissOverlay -> activeOverlay = null
            RoomBackAction.DismissMenu -> roomMenuExpanded = false
            RoomBackAction.MinimizePlayer -> onMinimizePlayer()
        }
    }

    BackHandler(onBack = handleBack)
    LaunchedEffect(activeOverlay) {
        viewModel.setChatVisible(activeOverlay == RoomOverlay.Chat)
    }
    DisposableEffect(Unit) {
        onDispose { viewModel.setChatVisible(false) }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val landscape = maxWidth > maxHeight

        LaunchedEffect(landscape, landscapeChromeVisible, roomMenuExpanded, activeOverlay) {
            if (landscape && landscapeChromeVisible && !roomMenuExpanded && activeOverlay == null) {
                delay(3_500)
                landscapeChromeVisible = false
            }
        }
        LaunchedEffect(landscape) {
            if (landscape) landscapeChromeVisible = true
        }

        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .padding(if (landscape) PaddingValues(0.dp) else outerPadding),
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                if (!landscape) {
                    RoomHeader(
                        room = room,
                        immersive = false,
                        menuExpanded = roomMenuExpanded,
                        onMenuExpandedChange = { roomMenuExpanded = it },
                        connectionStatus = appState.connectionStatus,
                        pingMs = appState.pingMs,
                        viewModel = viewModel,
                        context = context,
                        onMinimizePlayer = onMinimizePlayer,
                        onOpenOverlay = { activeOverlay = it },
                    )
                }
            },
        ) { padding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(if (landscape) PaddingValues(0.dp) else padding),
            ) {
                PlayerPane(
                    room = room,
                    lyrics = appState.lyrics,
                    lyricOffsets = appState.lyricOffsets,
                    activeVote = appState.activeVote,
                    userId = appState.userId,
                    chatUnreadCount = appState.chatUnreadCount,
                    visualMotionEnabled = activeOverlay == null,
                    viewModel = viewModel,
                    immersiveLandscape = landscape,
                    landscapeChromeVisible = landscapeChromeVisible,
                    safeContentPadding =
                        if (landscape) outerPadding else PaddingValues(0.dp),
                    onSurfaceTap = {
                        if (landscape) landscapeChromeVisible = !landscapeChromeVisible
                    },
                    onOpenQueue = { activeOverlay = RoomOverlay.Queue },
                    onOpenChat = { activeOverlay = RoomOverlay.Chat },
                )
                AnimatedVisibility(
                    visible = landscape && landscapeChromeVisible,
                    modifier = Modifier.align(Alignment.TopCenter),
                    enter = fadeIn(tween(220)) + slideInVertically(tween(260)) { -it / 3 },
                    exit = fadeOut(tween(180)) + slideOutVertically(tween(220)) { -it / 3 },
                ) {
                    RoomHeader(
                        room = room,
                        immersive = true,
                        safeContentPadding = outerPadding,
                        menuExpanded = roomMenuExpanded,
                        onMenuExpandedChange = {
                            roomMenuExpanded = it
                            if (it) landscapeChromeVisible = true
                        },
                        connectionStatus = appState.connectionStatus,
                        pingMs = appState.pingMs,
                        viewModel = viewModel,
                        context = context,
                        onMinimizePlayer = onMinimizePlayer,
                        onOpenOverlay = {
                            landscapeChromeVisible = false
                            activeOverlay = it
                        },
                    )
                }
            }
        }

        activeOverlay?.let { overlay ->
            if (landscape && (overlay == RoomOverlay.Queue || overlay == RoomOverlay.Chat)) {
                LandscapeRoomSidePanel(
                    overlay = overlay,
                    room = room,
                    messages = appState.messages,
                    viewModel = viewModel,
                    safeContentPadding = outerPadding,
                    onDismiss = { activeOverlay = null },
                    onOpenDownload = { activeOverlay = RoomOverlay.Download },
                )
            } else {
                val navigateUpFromOverlay = {
                    if (overlay == RoomOverlay.Accounts && appState.platformHub.selectedPlaylist != null) {
                        viewModel.closePlaylist()
                    } else {
                        activeOverlay = null
                    }
                }
                AppModalBottomSheet(
                    onDismissRequest = navigateUpFromOverlay,
                    sheetState = overlaySheetState,
                    title = if (overlay == RoomOverlay.Accounts) {
                        appState.platformHub.selectedPlaylist?.name ?: overlay.title
                    } else {
                        overlay.title
                    },
                    startAction = if (LocalUiStyle.current == UiStyle.Miuix) {
                        {
                            MiuixIconButton(onClick = navigateUpFromOverlay) {
                                MiuixIcon(
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "返回播放器",
                                )
                            }
                        }
                    } else null,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .fillMaxHeight(
                                when (overlay) {
                                    RoomOverlay.Queue, RoomOverlay.Chat, RoomOverlay.Members, RoomOverlay.Download -> 0.70f
                                    RoomOverlay.Accounts, RoomOverlay.AccountSettings, RoomOverlay.RoomSettings -> 0.90f
                                    RoomOverlay.Search, RoomOverlay.Recommendations -> 0.96f
                                },
                            ),
                    ) {
                        when (overlay) {
                            RoomOverlay.Queue -> QueuePane(
                                room = room,
                                viewModel = viewModel,
                                onDownloadCurrent = { activeOverlay = RoomOverlay.Download },
                            )
                            RoomOverlay.Search -> SearchPane(appState, viewModel)
                            RoomOverlay.Recommendations -> RecommendationsPane(appState, viewModel)
                            RoomOverlay.Download -> MusicDownloadPane(appState, viewModel)
                            RoomOverlay.Chat -> ChatPane(appState.messages, viewModel)
                            RoomOverlay.Members -> MembersPane(
                                room = room,
                                userId = appState.userId,
                                canManageRoles = room.users.firstOrNull { it.id == appState.userId }?.let { user ->
                                    user.role == "owner" || user.isServerAdmin
                                } == true || appState.accountProfile?.role == "admin",
                                onSetRole = viewModel::updateRoomMemberRole,
                            )
                            RoomOverlay.Accounts -> PlatformPane(appState, viewModel)
                            RoomOverlay.AccountSettings -> AccountSettingsPane(appState, viewModel)
                            RoomOverlay.RoomSettings -> RoomSettingsPane(appState, viewModel)
                        }
                    }
                }
            }
        }
        BilibiliCollectionDialog(appState.bilibiliCollection, viewModel)
        BilibiliMetadataDialog(appState.bilibiliMetadataMatch, viewModel)
    }
}
