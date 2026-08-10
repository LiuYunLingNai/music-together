package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem

private data class RoomTarget(val serverUrl: String, val room: RoomListItem)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    state: AppState,
    contentPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    bottomContentPadding: Dp = 0.dp,
) {
    var createDialog by remember { mutableStateOf(false) }
    var joinTarget by remember { mutableStateOf<RoomTarget?>(null) }
    var directRoomId by remember { mutableStateOf("") }
    var connectionSettingsOpen by remember { mutableStateOf(false) }
    var accountSettingsOpen by remember { mutableStateOf(false) }
    var localLibraryOpen by remember { mutableStateOf(false) }
    val connectedServerCount = state.servers.count { it.status == ConnectionStatus.Connected }
    val roomCount = state.servers.sumOf { it.rooms.size }

    if (localLibraryOpen) {
        LocalMusicPane(
            state = state,
            viewModel = viewModel,
            onBack = { localLibraryOpen = false },
        )
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(
            start = 16.dp,
            top = 12.dp,
            end = 16.dp,
            bottom = 20.dp + bottomContentPadding,
        ),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Default.MusicNote,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "Music Together",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "$connectedServerCount/${state.servers.size} 台服务器在线",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { connectionSettingsOpen = true }) {
                    Icon(Icons.Default.Settings, contentDescription = "服务器设置")
                }
                IconButton(onClick = { localLibraryOpen = true }) {
                    Icon(Icons.Default.LibraryMusic, contentDescription = "本地音乐")
                }
                IconButton(onClick = { accountSettingsOpen = true }) {
                    if (state.accountProfile?.avatarUrl != null) {
                        AsyncImage(
                            model = state.accountProfile.avatarUrl,
                            contentDescription = "账户设置",
                            modifier = Modifier
                                .size(30.dp)
                                .clip(CircleShape),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Icon(Icons.Default.AccountCircle, contentDescription = "账户设置")
                    }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "快速开始",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Button(
                    onClick = { createDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(text = "创建房间", modifier = Modifier.padding(start = 8.dp))
                }
                OutlinedTextField(
                    value = directRoomId,
                    onValueChange = { directRoomId = it.take(512) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("加入房间") },
                    placeholder = { Text("房间号或邀请链接") },
                    trailingIcon = {
                        IconButton(
                            onClick = { viewModel.joinRoomInput(directRoomId) },
                            enabled = directRoomId.isNotBlank(),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = "加入房间")
                        }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(
                        onDone = {
                            if (directRoomId.isNotBlank()) viewModel.joinRoomInput(directRoomId)
                        },
                    ),
                )
            }
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "公开房间",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "$roomCount 个房间 · ${state.servers.size} 台服务器",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = viewModel::refreshRooms,
                    enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "刷新房间")
                }
            }
        }
        if (state.servers.all { it.rooms.isEmpty() }) {
            item {
                EmptyRoomList(
                    title =
                        if (state.servers.any { it.status == ConnectionStatus.Connected }) {
                            "暂无公开房间"
                        } else {
                            "正在连接服务器"
                        },
                )
            }
        } else {
            state.servers.filter { it.rooms.isNotEmpty() }.forEach { server ->
                item(key = "server:${server.url}") {
                    ServerHeader(
                        url = server.url,
                        status = server.status,
                        roomCount = server.rooms.size,
                        selected = server.url == state.selectedServerUrl,
                    )
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
private fun EmptyRoomList(title: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Default.People,
            contentDescription = null,
            modifier = Modifier.size(30.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ServerHeader(
    url: String,
    status: ConnectionStatus,
    roomCount: Int,
    selected: Boolean,
) {
    val statusColor =
        when (status) {
            ConnectionStatus.Connected -> MaterialTheme.colorScheme.primary
            ConnectionStatus.Connecting -> MaterialTheme.colorScheme.tertiary
            ConnectionStatus.Disconnected -> MaterialTheme.colorScheme.outline
        }
    val subtitle =
        when (status) {
            ConnectionStatus.Connected -> if (selected) "当前服务器" else "$roomCount 个房间"
            ConnectionStatus.Connecting -> "正在连接"
            ConnectionStatus.Disconnected -> "已离线"
        }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(statusColor),
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = url.removePrefix("https://").removePrefix("http://"),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RoomCard(room: RoomListItem, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = room.name,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (room.hasPassword) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = "需要密码",
                        modifier = Modifier.size(17.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.People,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = room.userCount.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "房间号 ${room.id}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                room.currentTrackTitle?.let { title ->
                    Icon(
                        imageVector = Icons.Default.MusicNote,
                        contentDescription = null,
                        modifier = Modifier
                            .padding(start = 6.dp)
                            .size(16.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = "$title${room.currentTrackArtist?.let { " · $it" }.orEmpty()}",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
