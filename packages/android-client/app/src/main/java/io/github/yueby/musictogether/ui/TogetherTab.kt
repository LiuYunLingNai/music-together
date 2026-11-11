package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.ServerConnection
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppSectionHeader
import io.github.yueby.musictogether.ui.designsystem.AppTabPage
import io.github.yueby.musictogether.ui.player.DropdownMenu
import io.github.yueby.musictogether.ui.player.DropdownMenuItem
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

private data class RoomTarget(val serverUrl: String, val room: RoomListItem)

@Composable
internal fun TogetherTab(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    bottomPadding: Dp,
    onOpenPlayer: (() -> Unit)?,
) {
    val navigator = LocalAppNavigator.current
    var addMenu by remember { mutableStateOf(false) }
    var passwordTarget by remember { mutableStateOf<RoomTarget?>(null) }
    val anyConnected = state.servers.any { it.status == ConnectionStatus.Connected }
    val serversWithRooms = state.servers.filter { it.rooms.isNotEmpty() }

    AppTabPage(
        title = "一起听",
        bottomPadding = bottomPadding,
        actions = {
            IconButton(onClick = viewModel::refreshRooms, enabled = anyConnected) {
                Icon(Icons.Default.Refresh, "刷新房间")
            }
            Box {
                IconButton(onClick = { addMenu = true }) { Icon(Icons.Default.Add, "创建或加入房间") }
                DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("创建房间") },
                        leadingIcon = { Icon(Icons.Default.Add, null) },
                        onClick = {
                            addMenu = false
                            navigator.open(AppRoute.CreateRoom)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("加入房间") },
                        leadingIcon = { Icon(Icons.Default.GroupAdd, null) },
                        onClick = {
                            addMenu = false
                            navigator.open(AppRoute.JoinRoom)
                        },
                    )
                }
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().overScrollVertical(),
            contentPadding = PaddingValues(bottom = padding.calculateBottomPadding() + 16.dp),
        ) {
            val room = state.room
            if (room != null) {
                item(key = "now") {
                    AppSectionHeader("正在收听")
                    NowListeningCard(room, onClick = onOpenPlayer)
                }
            } else {
                item(key = "start") { StartListeningCard(navigator) }
            }
            when {
                serversWithRooms.isEmpty() && !anyConnected -> item(key = "offline") {
                    AppEmptyState(
                        icon = Icons.Default.CloudOff,
                        title = if (state.servers.any { it.status == ConnectionStatus.Connecting }) "正在连接服务器" else "服务器未连接",
                        summary = "连接后可浏览公开房间和音乐内容",
                        actionText = "服务器设置",
                        onAction = { navigator.open(AppRoute.Server) },
                    )
                }
                serversWithRooms.isEmpty() -> item(key = "empty") {
                    AppEmptyState(
                        icon = Icons.Default.People,
                        title = "暂无公开房间",
                        summary = "创建一个房间，把链接分享给朋友",
                    )
                }
                else -> serversWithRooms.forEach { server ->
                    item(key = "server:${server.url}") {
                        AppSectionHeader(serverSectionTitle(server, state.selectedServerUrl))
                        Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                            server.rooms.forEachIndexed { index, item ->
                                if (index > 0) HorizontalDivider(Modifier.padding(start = 16.dp))
                                PublicRoomRow(
                                    room = item,
                                    current = item.id == room?.id,
                                    onClick = {
                                        when {
                                            item.id == room?.id -> onOpenPlayer?.invoke()
                                            item.hasPassword -> passwordTarget = RoomTarget(server.url, item)
                                            else -> viewModel.joinRoomOnServer(server.url, item.id)
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    passwordTarget?.let { target ->
        PasswordDialog(target.room.name, onDismiss = { passwordTarget = null }) { password ->
            passwordTarget = null
            viewModel.joinRoomOnServer(target.serverUrl, target.room.id, password)
        }
    }
}

private fun serverSectionTitle(server: ServerConnection, selectedUrl: String): String {
    val host = server.url.removePrefix("https://").removePrefix("http://")
    val status = when (server.status) {
        ConnectionStatus.Connected -> if (server.url == selectedUrl) "当前服务器" else "${server.rooms.size} 个房间"
        ConnectionStatus.Connecting -> "连接中"
        ConnectionStatus.Disconnected -> "离线"
    }
    return "$host · $status"
}

@Composable
private fun StartListeningCard(navigator: AppNavigator) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("和朋友同步听歌", style = MiuixTheme.textStyles.title3, fontWeight = FontWeight.SemiBold)
            Text(
                "创建房间后分享链接，或输入房间号加入",
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AppButton(
                    text = "创建房间",
                    onClick = { navigator.open(AppRoute.CreateRoom) },
                    modifier = Modifier.weight(1f),
                )
                AppButton(
                    text = "加入房间",
                    onClick = { navigator.open(AppRoute.JoinRoom) },
                    modifier = Modifier.weight(1f),
                    primary = false,
                )
            }
        }
    }
}

@Composable
private fun NowListeningCard(room: RoomState, onClick: (() -> Unit)?) {
    val track = room.currentTrack
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (track != null) {
                TrackCover(track = track, size = 60.dp, cornerRadius = 12.dp)
            } else {
                Box(
                    Modifier.size(60.dp).clip(CircleShape).background(MiuixTheme.colorScheme.secondaryContainer),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.MusicNote, null, tint = MiuixTheme.colorScheme.onSecondaryContainer) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    track?.title ?: "等待点歌",
                    style = MiuixTheme.textStyles.title4,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                track?.let {
                    Text(
                        it.artist.joinToString(" / "),
                        style = MiuixTheme.textStyles.body2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    "${room.name} · ${room.users.size} 人在线",
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForward, "打开播放器", tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
        }
    }
}

@Composable
private fun PublicRoomRow(room: RoomListItem, current: Boolean, onClick: () -> Unit) {
    val onHapticClick = rememberHapticClick(onClick)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onHapticClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    room.name,
                    modifier = Modifier.weight(1f, fill = false),
                    style = MiuixTheme.textStyles.body1,
                    fontWeight = FontWeight.Medium,
                    color = if (current) MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (room.hasPassword) {
                    Icon(Icons.Default.Lock, "需要密码", Modifier.size(14.dp), tint = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                }
            }
            Text(
                buildString {
                    append(room.userCount).append(" 人 · 房间号 ").append(room.id)
                    room.currentTrackTitle?.let { title ->
                        append(" · ♪ ").append(title)
                        room.currentTrackArtist?.let { append(" - ").append(it) }
                    }
                },
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MiuixTheme.colorScheme.onSurfaceVariantActions,
        )
    }
}
