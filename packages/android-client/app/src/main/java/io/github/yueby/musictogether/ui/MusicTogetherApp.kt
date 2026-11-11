package io.github.yueby.musictogether.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.designsystem.AppPage
import io.github.yueby.musictogether.ui.designsystem.AppScaffold
import io.github.yueby.musictogether.ui.player.MinimizedPlayerBar
import io.github.yueby.musictogether.ui.player.PlayerMinimizeTransitionHost
import top.yukonga.miuix.kmp.nav.core.NavDisplay
import top.yukonga.miuix.kmp.nav.core.navBackStackOf
import top.yukonga.miuix.kmp.nav.transition.NavSwipeDirection

@Composable
fun MusicTogetherApp(viewModel: MusicTogetherViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val catalog by viewModel.catalogState.collectAsStateWithLifecycle()
    val context = LocalContext.current.applicationContext
    val backStack = remember { navBackStackOf(AppRoute.Shell) }
    val navigator = remember(backStack) { AppNavigator(backStack, viewModel) }
    val roomId = state.room?.id
    var observedRoomId by remember { mutableStateOf(roomId) }

    LifecycleEventEffect(Lifecycle.Event.ON_START) { viewModel.setAppForeground(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { viewModel.setAppForeground(false) }

    LaunchedEffect(state.error) {
        state.error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }
    LaunchedEffect(state.notice?.id) {
        state.notice?.let {
            Toast.makeText(context, it.text, if (it.isError) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
            viewModel.clearNotice()
        }
    }
    LaunchedEffect(state.hapticFeedbackEnabled) {
        syncHapticFeedbackSetting(state.hapticFeedbackEnabled)
    }
    LaunchedEffect(roomId) {
        if (observedRoomId != roomId) {
            if (roomId != null) navigator.popToShell() else navigator.dropRoomRoutes()
            observedRoomId = roomId
        }
    }
    AppRouteLifecycleEffects(navigator, viewModel)

    CompositionLocalProvider(LocalAppNavigator provides navigator) {
        AppScaffold { padding ->
            NavDisplay(
                backStack = backStack,
                modifier = Modifier.fillMaxSize(),
                onBack = navigator::pop,
            ) {
                entry<AppRoute.Shell> {
                    AppShell(state, viewModel, padding, shellOnTop = backStack.size <= 1)
                }
                entry<AppRoute.Search>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    SearchScreen(state, viewModel, onBack = navigator::pop)
                }
                entry<AppRoute.Recommendations>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    AppPage("推荐点歌", onBack = navigator::pop) { PersonalRecommendations(state, viewModel) }
                }
                entry<AppRoute.PlaylistDetail>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    val playlist = state.platformHub.selectedPlaylist
                    AppPage(title = playlist?.name ?: "歌单", onBack = navigator::pop) {
                        playlist?.let { PlaylistDetailPane(state, it, viewModel) }
                    }
                }
                entry<AppRoute.Artist>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    AppPage(title = catalog.artist?.artist?.name ?: "歌手", onBack = navigator::pop) {
                        ArtistPane(state, viewModel)
                    }
                }
                entry<AppRoute.UserPlaylist>(swipeDismiss = NavSwipeDirection.LeftToRight) { route ->
                    UserPlaylistScreen(
                        id = route.id,
                        state = state,
                        viewModel = viewModel,
                        onBack = { if (backStack.lastOrNull() == route) navigator.pop() },
                    )
                }
                entry<AppRoute.RoomInfo> {
                    AppPage("房间与同步", onBack = navigator::pop) { RoomSettingsPane(state, viewModel) }
                }
                entry<AppRoute.Members>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    state.room?.let { room ->
                        AppPage("房间成员 · ${room.users.size}", onBack = navigator::pop) {
                            MembersPane(
                                room = room,
                                userId = state.userId,
                                canManageRoles = room.users.firstOrNull { it.id == state.userId }?.let { user ->
                                    user.role == "owner" || user.isServerAdmin
                                } == true || state.accountProfile?.role == "admin",
                                onSetRole = viewModel::updateRoomMemberRole,
                                onKick = viewModel::kickRoomMember,
                                onUnban = viewModel::unbanRoomMember,
                            )
                        }
                    }
                }
                entry<AppRoute.Queue>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    state.room?.let { room ->
                        AppPage("播放队列", onBack = navigator::pop, subtitle = "${room.queue.size} 首", actions = { QueueClearAction(room, viewModel) }) {
                            QueuePane(room, viewModel, onDownloadCurrent = { navigator.open(AppRoute.Download) })
                        }
                    }
                }
                entry<AppRoute.Chat>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    DisposableEffect(Unit) {
                        viewModel.setChatVisible(true)
                        onDispose { viewModel.setChatVisible(false) }
                    }
                    AppPage("聊天", onBack = navigator::pop) { ChatPane(state.messages, state.userId, viewModel) }
                }
                entry<AppRoute.HotSongs>(swipeDismiss = NavSwipeDirection.LeftToRight) {
                    AppPage("热歌榜", onBack = navigator::pop, actions = { HotSongsRefreshAction(viewModel) }) { HotSongsPane(state, viewModel) }
                }
                entry<AppRoute.Download> {
                    AppPage("下载当前歌曲", onBack = navigator::pop) { MusicDownloadPane(state, viewModel) }
                }
                entry<AppRoute.CreateRoom> {
                    AppPage("创建房间", onBack = navigator::pop) { CreateRoomForm(state, viewModel) }
                }
                entry<AppRoute.JoinRoom> {
                    AppPage("加入房间", onBack = navigator::pop) { JoinRoomForm(state, viewModel) }
                }
                entry<AppRoute.PlatformAccounts> {
                    AppPage("音乐平台账号", onBack = navigator::pop) { PlatformPane(state, viewModel) }
                }
                entry<AppRoute.Account> {
                    AppPage("账号与安全", onBack = navigator::pop) { AccountSettingsPane(state, viewModel) }
                }
                entry<AppRoute.Server> {
                    AppPage("服务器连接", onBack = navigator::pop) { ConnectionSettingsPane(state, viewModel) }
                }
                entry<AppRoute.Appearance> {
                    AppPage("外观与主题", onBack = navigator::pop) { AppearanceSettingsPage(state, viewModel) }
                }
                entry<AppRoute.PlayerDisplay> {
                    AppPage("歌词与播放器", onBack = navigator::pop) { PlayerSettingsPage(state.playerDisplaySettings, viewModel) }
                }
                entry<AppRoute.General> {
                    AppPage("通用", onBack = navigator::pop) { GeneralSettingsPage(state, viewModel) }
                }
                entry<AppRoute.Updates> {
                    AppPage("应用更新", onBack = navigator::pop) { AppUpdatePane(state, viewModel) }
                }
                entry<AppRoute.Admin> {
                    val isAdmin = state.accountProfile?.role == "admin"
                    LaunchedEffect(isAdmin) { if (isAdmin) viewModel.loadAdminData() else navigator.pop() }
                    AppPage("服务器管理", onBack = navigator::pop) { AdminManagementSection(state, viewModel) }
                }
            }
        }

        BilibiliCollectionDialog(state.bilibiliCollection, viewModel)
        BilibiliMetadataDialog(state.bilibiliMetadataMatch, viewModel)
        RoomShareDialog(state.roomShare, viewModel)
        state.playbackFailure?.takeIf { it.visible && state.room != null }?.let { failure ->
            PlaybackFailureDialog(
                state = failure,
                canRetry = viewModel.canControl() || failure.localOnly || state.room?.playState?.isPlaying == true,
                canControl = viewModel.canControl(),
                onDismiss = viewModel::dismissPlaybackFailure,
                onRetry = { viewModel.retryPlaybackFailure() },
                onDegrade = { viewModel.retryPlaybackFailure(degrade = true) },
                onSwitchSource = viewModel::switchFailedPlaybackSource,
                onSkip = viewModel::skipPlaybackFailure,
            )
        }
    }
}

@Composable
private fun AppShell(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    padding: PaddingValues,
    shellOnTop: Boolean,
) {
    val player by viewModel.playerState.collectAsStateWithLifecycle()
    val room = state.room
    val navigator = LocalAppNavigator.current
    var playerMinimized by rememberSaveable(room?.id) { mutableStateOf(false) }
    val showHome = room == null || playerMinimized

    Box(Modifier.fillMaxSize()) {
        PlayerMinimizeTransitionHost(
            roomId = room?.id,
            showHome = showHome,
            minimizedTarget = showHome && playerMinimized,
            modifier = Modifier.fillMaxSize(),
            homeContent = {
                MainTabsScreen(
                    state = state,
                    contentPadding = padding,
                    viewModel = viewModel,
                    shellOnTop = shellOnTop,
                    onOpenPlayer = room?.let { { playerMinimized = false } },
                    bottomAccessory = room?.takeIf { playerMinimized }?.let { activeRoom ->
                        { blurBackdrop, compact ->
                            MinimizedPlayerBar(
                                track = player.track ?: activeRoom.currentTrack,
                                player = player,
                                viewModel = viewModel,
                                onExpand = { playerMinimized = false },
                                onOpenQueue = { navigator.open(AppRoute.Queue) },
                                blurBackdrop = blurBackdrop,
                                compact = compact,
                            )
                        }
                    },
                )
            },
            playerContent = {
                if (room != null) {
                    RoomScreen(
                        appState = state,
                        outerPadding = padding,
                        viewModel = viewModel,
                        shellOnTop = shellOnTop,
                        onMinimizePlayer = { playerMinimized = true },
                    )
                }
            },
        )
    }
}
