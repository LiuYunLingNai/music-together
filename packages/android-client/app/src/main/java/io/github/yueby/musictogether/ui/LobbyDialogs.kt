package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.ServerConnection

@Composable
internal fun ConnectionSettingsDialog(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("连接设置") },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 560.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = state.serverUrl,
                    onValueChange = viewModel::updateServerUrl,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("服务器 URL") },
                    supportingText = { Text("例如 https://music.example.com") },
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
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(8.dp))
                    }
                    Text(
                        when (state.connectionStatus) {
                            ConnectionStatus.Connected -> "添加并切换"
                            ConnectionStatus.Connecting -> "正在连接"
                            ConnectionStatus.Disconnected -> "添加并连接"
                        },
                    )
                }
                state.servers.forEachIndexed { index, server ->
                    if (index > 0) HorizontalDivider()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Default.Dns,
                            contentDescription = null,
                            tint = if (server.status == ConnectionStatus.Connected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        Column(Modifier.weight(1f)) {
                            Text(
                                server.url,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight =
                                    if (server.url == state.selectedServerUrl) {
                                        FontWeight.SemiBold
                                    } else {
                                        FontWeight.Normal
                                    },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when (server.status) {
                                    ConnectionStatus.Connected -> "已连接 · ${server.rooms.size} 个房间"
                                    ConnectionStatus.Connecting -> "连接中"
                                    ConnectionStatus.Disconnected -> server.error ?: "未连接"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (server.url != state.selectedServerUrl) {
                            TextButton(onClick = { viewModel.selectServer(server.url) }) {
                                Text("切换")
                            }
                        }
                        IconButton(
                            onClick = { viewModel.removeServer(server.url) },
                            enabled = state.servers.size > 1,
                        ) {
                            Icon(Icons.Default.Delete, "移除服务器")
                        }
                    }
                }
                if (BuildConfig.DEBUG) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilledTonalButton(
                            onClick = { AppLogger.export(context) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Default.FileUpload, null)
                            Spacer(Modifier.size(6.dp))
                            Text("导出日志")
                        }
                        FilledTonalButton(
                            onClick = viewModel::clearLogs,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Default.DeleteSweep, null)
                            Spacer(Modifier.size(6.dp))
                            Text("清空日志")
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("完成")
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CreateRoomDialog(
    servers: List<ServerConnection>,
    initialServerUrl: String,
    onDismiss: () -> Unit,
    onCreate: (String, String, String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var selectedServerUrl by remember(initialServerUrl) { mutableStateOf(initialServerUrl) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("创建房间") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("创建到服务器", style = MaterialTheme.typography.labelLarge)
                servers.forEach { server ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedServerUrl = server.url }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        RadioButton(
                            selected = selectedServerUrl == server.url,
                            onClick = { selectedServerUrl = server.url },
                        )
                        Column(Modifier.weight(1f)) {
                            Text(
                                server.url,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when (server.status) {
                                    ConnectionStatus.Connected -> "已连接"
                                    ConnectionStatus.Connecting -> "连接中"
                                    ConnectionStatus.Disconnected -> "未连接，创建时将自动连接"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                HorizontalDivider()
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
        confirmButton = {
            Button(
                onClick = { onCreate(selectedServerUrl, name, password) },
                enabled = servers.any { it.url == selectedServerUrl },
            ) {
                Text("创建")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
internal fun PasswordDialog(roomName: String, onDismiss: () -> Unit, onJoin: (String) -> Unit) {
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
