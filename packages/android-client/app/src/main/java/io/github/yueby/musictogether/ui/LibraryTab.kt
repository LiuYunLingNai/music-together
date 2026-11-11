package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.UserPlaylist
import io.github.yueby.musictogether.model.UserPlaylistAccess
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppLoadingState
import io.github.yueby.musictogether.ui.designsystem.AppSectionHeader
import io.github.yueby.musictogether.ui.designsystem.AppTabPage
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.TabRow
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

private val libraryPlatforms = listOf("netease", "tencent", "kugou", "kugou_concept", "bilibili")

@Composable
internal fun LibraryTab(state: AppState, viewModel: MusicTogetherViewModel, bottomPadding: Dp) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    AppTabPage(title = "媒体库", bottomPadding = bottomPadding) { padding ->
        Column(Modifier.fillMaxSize()) {
            TabRow(
                tabs = listOf("我的歌单", "下载", "平台歌单"),
                selectedTabIndex = tab,
                onTabSelected = { tab = it },
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
            Box(Modifier.weight(1f)) {
                when (tab) {
                    0 -> UserPlaylistsSection(state, viewModel, padding)
                    1 -> LocalMusicPane(state, viewModel, contentPadding = padding)
                    else -> PlatformPlaylistsSection(state, viewModel, padding)
                }
            }
        }
    }
}

@Composable
private fun UserPlaylistsSection(state: AppState, viewModel: MusicTogetherViewModel, padding: PaddingValues) {
    val navigator = LocalAppNavigator.current
    val playlists by viewModel.userPlaylistState.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }
    val connected = state.connectionStatus == ConnectionStatus.Connected
    LaunchedEffect(connected, state.userId, state.accountProfile?.hasPassword) {
        if (connected) viewModel.loadUserPlaylists()
    }

    when {
        !connected && playlists.playlists.isEmpty() -> AppEmptyState(
            icon = Icons.Default.CloudOff,
            title = "服务器未连接",
            summary = "账户歌单保存在服务器上，连接后即可查看",
        )
        playlists.access == UserPlaylistAccess.RequiresPassword -> AppEmptyState(
            icon = Icons.Default.Lock,
            title = "设置账号密码后使用歌单",
            summary = "歌单跟随服务器账号保存，可以收藏任意音源的歌曲，换设备登录也能找回",
            actionText = "前往账号设置",
            onAction = { navigator.open(AppRoute.Account) },
        )
        playlists.loading && playlists.playlists.isEmpty() -> AppLoadingState()
        playlists.error != null && playlists.playlists.isEmpty() -> AppEmptyState(
            icon = Icons.Default.ErrorOutline,
            title = "歌单加载失败",
            summary = playlists.error,
            actionText = "重试",
            onAction = { viewModel.loadUserPlaylists(force = true) },
        )
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize().overScrollVertical(),
            contentPadding = PaddingValues(top = 6.dp, bottom = 16.dp + padding.calculateBottomPadding()),
        ) {
            item(key = "list") {
                Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !playlists.busy) { creating = true }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(MiuixTheme.colorScheme.secondaryContainer),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Default.Add, null, tint = MiuixTheme.colorScheme.onSecondaryContainer) }
                        Text(
                            "新建歌单",
                            modifier = Modifier.padding(start = 12.dp),
                            style = MiuixTheme.textStyles.body1,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                    playlists.playlists.forEach { playlist ->
                        HorizontalDivider(Modifier.padding(start = 76.dp))
                        UserPlaylistRow(playlist) { navigator.openUserPlaylist(playlist.id) }
                    }
                }
            }
            if (playlists.playlists.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "在任意歌曲的「更多」菜单里选择「添加到歌单」即可收藏",
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        style = MiuixTheme.textStyles.body2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
    }

    if (creating) {
        NameInputDialog(
            title = "新建歌单",
            initialValue = "",
            confirmText = "创建",
            onDismiss = { creating = false },
        ) { name ->
            creating = false
            viewModel.createUserPlaylist(name)
        }
    }
}

@Composable
private fun UserPlaylistRow(playlist: UserPlaylist, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        UserPlaylistCover(playlist.cover, 48.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            Text(
                "${playlist.trackCount} 首",
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
    }
}

@Composable
internal fun UserPlaylistCover(cover: String?, size: Dp) {
    val shape = RoundedCornerShape(size / 5)
    if (cover.isNullOrBlank()) {
        Box(
            Modifier.size(size).clip(shape).background(MiuixTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.QueueMusic,
                null,
                Modifier.size(size / 2),
                tint = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
    } else {
        AsyncImage(
            model = cover,
            contentDescription = null,
            modifier = Modifier.size(size).clip(shape),
            contentScale = ContentScale.Crop,
        )
    }
}

@Composable
private fun PlatformPlaylistsSection(state: AppState, viewModel: MusicTogetherViewModel, padding: PaddingValues) {
    val navigator = LocalAppNavigator.current
    val hub = state.platformHub
    if (state.room == null) {
        AppEmptyState(
            icon = Icons.Default.Groups,
            title = "加入房间后查看平台歌单",
            summary = "音乐平台的登录凭据按房间隔离保存",
        )
        return
    }
    val loggedIn = libraryPlatforms.filter { platform -> hub.myAuth.any { it.platform == platform && it.loggedIn } }
    LaunchedEffect(Unit) { viewModel.requestPlatformStatus() }
    LaunchedEffect(loggedIn) {
        loggedIn.forEach { platform ->
            if (hub.playlists[platform].isNullOrEmpty() && platform !in hub.playlistsLoading) viewModel.fetchMyPlaylists(platform)
        }
    }
    when {
        !hub.statusLoaded -> AppLoadingState()
        loggedIn.isEmpty() -> AppEmptyState(
            icon = Icons.AutoMirrored.Filled.Login,
            title = "还没有登录音乐平台",
            summary = "登录后可以浏览并点播自己的歌单",
            actionText = "登录音乐平台",
            onAction = { navigator.open(AppRoute.PlatformAccounts) },
        )
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize().overScrollVertical(),
            contentPadding = PaddingValues(bottom = 16.dp + padding.calculateBottomPadding()),
        ) {
            loggedIn.forEach { platform ->
                val items = hub.playlists[platform].orEmpty()
                val loading = platform in hub.playlistsLoading
                item(key = "header:$platform") {
                    AppSectionHeader(platformLabel(platform)) {
                        if (loading) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            IconButton(onClick = { viewModel.fetchMyPlaylists(platform) }) {
                                Icon(Icons.Default.Refresh, "刷新${platformLabel(platform)}歌单", Modifier.size(20.dp))
                            }
                        }
                    }
                }
                if (items.isEmpty() && !loading) {
                    item(key = "empty:$platform") {
                        Text(
                            "暂无${platformCollectionLabel(platform)}",
                            modifier = Modifier.padding(horizontal = 28.dp, vertical = 8.dp),
                            style = MiuixTheme.textStyles.body2,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        )
                    }
                }
                items(items, key = { "$platform:${it.id}" }) { playlist ->
                    PlaylistRow(playlist) { navigator.openPlaylist(playlist) }
                }
            }
        }
    }
}
