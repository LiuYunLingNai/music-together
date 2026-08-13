package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.ServerConnection
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppTextField
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Full-page server management used by the settings navigation stack. */
@Composable
internal fun ConnectionSettingsPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ConnectionEditor(state, viewModel)
        state.servers.forEach { server ->
            ServerConnectionItem(
                server = server,
                selected = server.url == state.selectedServerUrl,
                removeEnabled = state.servers.size > 1,
                onSelect = { viewModel.selectServer(server.url) },
                onRemove = { viewModel.removeServer(server.url) },
            )
        }
        if (BuildConfig.DEBUG) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                AppButton(
                    text = "导出日志",
                    onClick = { AppLogger.export(context) },
                    modifier = Modifier.weight(1f),
                    primary = false,
                )
                AppButton(
                    text = "清空日志",
                    onClick = viewModel::clearLogs,
                    modifier = Modifier.weight(1f),
                    primary = false,
                )
            }
        }
        Spacer(Modifier.size(8.dp))
    }
}

@Composable
private fun ConnectionEditor(state: AppState, viewModel: MusicTogetherViewModel) {
    val fields: @Composable () -> Unit = {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AppTextField(
                value = state.serverUrl,
                onValueChange = viewModel::updateServerUrl,
                modifier = Modifier.fillMaxWidth(),
                label = "服务器 URL，例如 https://music.example.com",
            )
            AppTextField(
                value = state.nickname,
                onValueChange = viewModel::updateNickname,
                modifier = Modifier.fillMaxWidth(),
                label = "昵称",
            )
            AppButton(
                text = when (state.connectionStatus) {
                    ConnectionStatus.Connected -> "添加并切换"
                    ConnectionStatus.Connecting -> "正在连接"
                    ConnectionStatus.Disconnected -> "添加并连接"
                },
                onClick = viewModel::connect,
                enabled = state.connectionStatus != ConnectionStatus.Connecting,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            content = { fields() },
        )
        UiStyle.Miuix -> MiuixCard(modifier = Modifier.fillMaxWidth(), content = { fields() })
    }
}

@Composable
private fun ServerConnectionItem(
    server: ServerConnection,
    selected: Boolean,
    removeEnabled: Boolean,
    onSelect: () -> Unit,
    onRemove: () -> Unit,
) {
    val body: @Composable () -> Unit = {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ConnectionStatusIcon(server.status)
            ConnectionStatusText(server, selected, Modifier.weight(1f))
            if (!selected) ConnectionSelectButton(onSelect)
            ConnectionRemoveButton(removeEnabled, onRemove)
        }
    }
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            content = { body() },
        )
        UiStyle.Miuix -> MiuixCard(modifier = Modifier.fillMaxWidth(), content = { body() })
    }
}

@Composable
private fun ConnectionStatusIcon(status: ConnectionStatus) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Icon(
            Icons.Default.Dns,
            contentDescription = null,
            tint = if (status == ConnectionStatus.Connected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        UiStyle.Miuix -> MiuixIcon(
            Icons.Default.Dns,
            contentDescription = null,
            tint = if (status == ConnectionStatus.Connected) MiuixTheme.colorScheme.primary
            else MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )
    }
}

@Composable
private fun ConnectionStatusText(server: ServerConnection, selected: Boolean, modifier: Modifier) {
    val summary = when (server.status) {
        ConnectionStatus.Connected -> "已连接 · ${server.rooms.size} 个房间"
        ConnectionStatus.Connecting -> "连接中"
        ConnectionStatus.Disconnected -> server.error ?: "未连接"
    }
    Column(modifier) {
        when (LocalUiStyle.current) {
            UiStyle.Material3 -> {
                Text(
                    server.url,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    summary,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            UiStyle.Miuix -> {
                MiuixText(
                    server.url,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                MiuixText(
                    summary,
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ConnectionSelectButton(onClick: () -> Unit) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> TextButton(onClick = onClick) { Text("切换") }
        UiStyle.Miuix -> MiuixTextButton(text = "切换", onClick = onClick)
    }
}

@Composable
private fun ConnectionRemoveButton(enabled: Boolean, onClick: () -> Unit) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> IconButton(onClick = onClick, enabled = enabled) {
            Icon(Icons.Default.Delete, contentDescription = "移除服务器")
        }
        UiStyle.Miuix -> MiuixIconButton(onClick = onClick, enabled = enabled) {
            MiuixIcon(Icons.Default.Delete, contentDescription = "移除服务器")
        }
    }
}
