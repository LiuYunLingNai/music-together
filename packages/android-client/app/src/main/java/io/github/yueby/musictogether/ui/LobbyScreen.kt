package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem

@Composable
fun LobbyScreen(state: AppState, contentPadding: PaddingValues, viewModel: MusicTogetherViewModel) {
    var createDialog by remember { mutableStateOf(false) }
    var joinTarget by remember { mutableStateOf<RoomListItem?>(null) }
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.MusicNote, null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text("Music Together", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("原生 Android 客户端", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { AppLogger.export(context) }) {
                    Icon(Icons.Default.FileUpload, "导出日志")
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("连接服务端", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = state.serverUrl,
                        onValueChange = viewModel::updateServerUrl,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("服务端 URL") },
                        supportingText = { Text("例如 https://music.example.com 或 http://192.168.1.8:3001") },
                    )
                    OutlinedTextField(
                        value = state.nickname,
                        onValueChange = viewModel::updateNickname,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("昵称") },
                    )
                    Button(onClick = viewModel::connect, modifier = Modifier.fillMaxWidth()) {
                        if (state.connectionStatus == ConnectionStatus.Connecting) {
                            CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.padding(4.dp))
                        }
                        Text(when (state.connectionStatus) {
                            ConnectionStatus.Connected -> "重新连接"
                            ConnectionStatus.Connecting -> "连接中"
                            ConnectionStatus.Disconnected -> "连接"
                        })
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("公开房间", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        if (state.connectionStatus == ConnectionStatus.Connected) "${state.rooms.size} 个房间" else "等待连接服务端",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = viewModel::refreshRooms, enabled = state.connectionStatus == ConnectionStatus.Connected) {
                    Icon(Icons.Default.Refresh, "刷新")
                }
                FilledTonalButton(
                    onClick = { createDialog = true },
                    enabled = state.connectionStatus == ConnectionStatus.Connected,
                ) {
                    Icon(Icons.Default.Add, null)
                    Text("创建")
                }
            }
        }
        if (state.rooms.isEmpty()) {
            item {
                Text(
                    if (state.connectionStatus == ConnectionStatus.Connected) "暂无房间，创建一个开始听歌吧。" else "连接后会显示房间列表。",
                    modifier = Modifier.padding(vertical = 28.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(state.rooms, key = { it.id }) { room ->
                RoomCard(room) {
                    if (room.hasPassword) joinTarget = room else viewModel.joinRoom(room.id)
                }
            }
        }
    }

    if (createDialog) {
        CreateRoomDialog(
            onDismiss = { createDialog = false },
            onCreate = { name, password ->
                createDialog = false
                viewModel.createRoom(name, password)
            },
        )
    }
    joinTarget?.let { room ->
        PasswordDialog(room.name, onDismiss = { joinTarget = null }) { password ->
            joinTarget = null
            viewModel.joinRoom(room.id, password)
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

@Composable
private fun CreateRoomDialog(onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("创建房间") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it.take(30) }, label = { Text("房间名（可选）") }, singleLine = true)
                OutlinedTextField(
                    password,
                    { password = it.take(32) },
                    label = { Text("密码（可选）") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
        },
        confirmButton = { Button(onClick = { onCreate(name, password) }) { Text("创建") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun PasswordDialog(roomName: String, onDismiss: () -> Unit, onJoin: (String) -> Unit) {
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("加入 $roomName") },
        text = {
            OutlinedTextField(
                password,
                { password = it.take(32) },
                label = { Text("房间密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
            )
        },
        confirmButton = { Button(onClick = { onJoin(password) }, enabled = password.isNotBlank()) { Text("加入") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
