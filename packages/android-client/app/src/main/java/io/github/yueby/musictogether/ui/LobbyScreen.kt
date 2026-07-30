package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem

private data class RoomTarget(val serverUrl: String, val room: RoomListItem)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(state: AppState, contentPadding: PaddingValues, viewModel: MusicTogetherViewModel) {
    var createDialog by remember { mutableStateOf(false) }
    var joinTarget by remember { mutableStateOf<RoomTarget?>(null) }
    var directRoomId by remember { mutableStateOf("") }
    var connectionSettingsOpen by remember { mutableStateOf(false) }
    var accountSettingsOpen by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.MusicNote, null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text("Music Together", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${state.servers.count { it.status == ConnectionStatus.Connected }}/${state.servers.size} 台服务器在线",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = { connectionSettingsOpen = true }) {
                    Text("连接设置")
                }
                IconButton(
                    onClick = { accountSettingsOpen = true },
                ) {
                    if (state.accountProfile?.avatarUrl != null) {
                        AsyncImage(
                            model = state.accountProfile.avatarUrl,
                            contentDescription = "账号设置",
                            modifier = Modifier.size(30.dp).clip(CircleShape),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Icon(Icons.Default.AccountCircle, "账号设置")
                    }
                }
            }
        }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Default.Headphones,
                    contentDescription = null,
                    modifier = Modifier.height(44.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "一起听见同一首歌",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "创建房间，或加入朋友正在播放的音乐",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(
                    onClick = { createDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f)) {
                            Text("创建房间", fontWeight = FontWeight.SemiBold)
                            Text(
                                "建立一个新的同步听歌房间",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Card(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(Icons.Default.People, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column {
                                Text("加入房间", fontWeight = FontWeight.SemiBold)
                                Text(
                                    "输入房间号或粘贴邀请链接",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedTextField(
                                value = directRoomId,
                                onValueChange = { directRoomId = it.take(512) },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                placeholder = { Text("房间号或邀请链接") },
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(
                                    onDone = {
                                        if (directRoomId.isNotBlank()) viewModel.joinRoomInput(directRoomId)
                                    },
                                ),
                            )
                            Button(
                                onClick = { viewModel.joinRoomInput(directRoomId) },
                                enabled = directRoomId.isNotBlank(),
                            ) {
                                Text("加入")
                            }
                        }
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("所有公开房间", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "${state.servers.sumOf { it.rooms.size }} 个房间 · ${state.servers.size} 台服务器",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = viewModel::refreshRooms,
                    enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                ) {
                    Icon(Icons.Default.Refresh, "刷新")
                }
            }
        }
        if (state.servers.all { it.rooms.isEmpty() }) {
            item {
                Text(
                    if (state.servers.any { it.status == ConnectionStatus.Connected }) {
                        "已连接的服务器暂无公开房间。"
                    } else {
                        "正在连接服务器，房间列表稍后显示。"
                    },
                    modifier = Modifier.padding(vertical = 28.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            state.servers.filter { it.rooms.isNotEmpty() }.forEach { server ->
                item(key = "server:${server.url}") {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            server.url.removePrefix("https://").removePrefix("http://"),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            when (server.status) {
                                ConnectionStatus.Connected -> if (server.url == state.selectedServerUrl) {
                                    "当前服务器"
                                } else {
                                    "${server.rooms.size} 个房间"
                                }
                                ConnectionStatus.Connecting -> "正在连接"
                                ConnectionStatus.Disconnected -> "离线 · 上次发现 ${server.rooms.size} 个房间"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(server.rooms, key = { room -> "${server.url}:${room.id}" }) { room ->
                    RoomCard(room) {
                        if (room.hasPassword) {
                            joinTarget = RoomTarget(server.url, room)
                        } else {
                            viewModel.joinRoomOnServer(server.url, room.id)
                        }
                    }
                }
            }
        }
    }

    if (connectionSettingsOpen) {
        ConnectionSettingsDialog(
            state = state,
            viewModel = viewModel,
            onDismiss = { connectionSettingsOpen = false },
        )
    }
    if (createDialog) {
        CreateRoomDialog(
            servers = state.servers,
            initialServerUrl = state.selectedServerUrl,
            onDismiss = { createDialog = false },
            onCreate = { serverUrl, name, password ->
                createDialog = false
                viewModel.createRoomOnServer(serverUrl, name, password)
            },
        )
    }
    joinTarget?.let { target ->
        PasswordDialog(target.room.name, onDismiss = { joinTarget = null }) { password ->
            joinTarget = null
            viewModel.joinRoomOnServer(target.serverUrl, target.room.id, password)
        }
    }
    if (accountSettingsOpen) {
        ModalBottomSheet(onDismissRequest = { accountSettingsOpen = false }) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.90f)) {
                AccountSettingsPane(state, viewModel)
            }
        }
    }
}

@Composable
private fun RoomCard(room: RoomListItem, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(room.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (room.hasPassword) Icon(Icons.Default.Lock, "需要密码")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.People, null)
                Text("${room.userCount} 人")
                Text("房间号 ${room.id}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            room.currentTrackTitle?.let {
                Text("正在播放：$it${room.currentTrackArtist?.let { artist -> " · $artist" }.orEmpty()}", maxLines = 1)
            }
        }
    }
}
