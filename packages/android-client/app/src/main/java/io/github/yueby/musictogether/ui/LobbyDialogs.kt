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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.ServerConnection
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppTextField

@Composable
internal fun JoinRoomDialog(
    initialValue: String,
    onDismiss: () -> Unit,
    onJoin: (String) -> Unit,
) {
    var input by remember(initialValue) { mutableStateOf(initialValue) }
    AppDialog(
        onDismissRequest = onDismiss,
        title = "加入房间",
        confirmText = "加入",
        onConfirm = { onJoin(input) },
        confirmEnabled = input.isNotBlank(),
    ) {
            AppTextField(
                value = input,
                onValueChange = { input = it.take(512) },
                modifier = Modifier.fillMaxWidth(),
                label = "房间号或邀请链接",
            )
    }
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
    AppDialog(
        onDismissRequest = onDismiss,
        title = "创建房间",
        confirmText = "创建",
        onConfirm = { onCreate(selectedServerUrl, name, password) },
        confirmEnabled = servers.any { it.url == selectedServerUrl },
    ) {
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
                AppTextField(name, { name = it.take(30) }, label = "房间名（可选）")
                AppTextField(
                    value = password,
                    onValueChange = { password = it.take(32) },
                    label = "密码（可选）",
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
    }
}

@Composable
internal fun PasswordDialog(roomName: String, onDismiss: () -> Unit, onJoin: (String) -> Unit) {
    var password by remember { mutableStateOf("") }
    AppDialog(
        onDismissRequest = onDismiss,
        title = "加入 $roomName",
        confirmText = "加入",
        onConfirm = { onJoin(password) },
        confirmEnabled = password.isNotBlank(),
    ) {
            AppTextField(
                value = password,
                onValueChange = { password = it.take(32) },
                label = "房间密码",
                visualTransformation = PasswordVisualTransformation(),
            )
    }
}
