package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Vibration
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState

private enum class LobbySettingsCategory(
    val title: String,
    val description: String,
    val icon: ImageVector,
) {
    Playback("播放与同步", "配置房间播放、音频焦点与同步行为", Icons.Default.PlayArrow),
    Account("账号与安全", "个人资料、账号 ID 和登录安全", Icons.Default.AccountCircle),
    Server("服务器连接", "添加、切换和管理服务器地址", Icons.Default.Dns),
    Updates("应用更新", "检查版本、下载和安装更新", Icons.Default.SystemUpdate),
    Downloads("下载与媒体库", "查看已下载歌曲和本地播放内容", Icons.Default.Download),
    General("通用", "触感反馈与其他应用同时播放", Icons.Default.Settings),
    Admin("服务器管理", "管理用户、房间和服务器策略", Icons.Default.Security),
}

@Composable
internal fun LobbySettingsPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    onOpenConnectionSettings: () -> Unit,
) {
    var selected by remember { mutableStateOf<LobbySettingsCategory?>(null) }
    val isAdmin = state.accountProfile?.role == "admin"
    val categories = remember(isAdmin, state.room != null) {
        buildList {
            if (state.room != null) add(LobbySettingsCategory.Playback)
            add(LobbySettingsCategory.Account)
            add(LobbySettingsCategory.Server)
            add(LobbySettingsCategory.Updates)
            add(LobbySettingsCategory.Downloads)
            add(LobbySettingsCategory.General)
            if (isAdmin) add(LobbySettingsCategory.Admin)
        }
    }

    selected?.let { category ->
        Column(Modifier.fillMaxSize()) {
            LobbyTabHeader(title = category.title, onBack = { selected = null }, onAction = null)
            when (category) {
                LobbySettingsCategory.Playback -> RoomSettingsPane(state, viewModel)
                LobbySettingsCategory.Account -> AccountSettingsPane(state, viewModel)
                LobbySettingsCategory.Server -> Unit
                LobbySettingsCategory.Updates -> AppUpdatePane(state, viewModel)
                LobbySettingsCategory.Downloads -> LocalMusicPane(state, viewModel, onBack = { selected = null })
                LobbySettingsCategory.General -> GeneralSettingsPane(state, viewModel)
                LobbySettingsCategory.Admin -> ServerAdminSettingsPane(state, viewModel)
            }
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(Modifier.padding(horizontal = 4.dp, vertical = 8.dp)) {
                Text("设置", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(
                    "按类别管理应用、账号和服务器",
                    modifier = Modifier.padding(top = 4.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        items(categories, key = { it.name }) { category ->
            SettingsCategoryCard(category) {
                if (category == LobbySettingsCategory.Server) {
                    onOpenConnectionSettings()
                } else {
                    selected = category
                }
            }
        }
    }
}

@Composable
private fun SettingsCategoryCard(category: LobbySettingsCategory, onClick: () -> Unit) {
    val onHapticClick = rememberHapticClick(onClick)
    Card(
        onClick = onHapticClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 17.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = category.icon,
                contentDescription = null,
                modifier = Modifier.size(27.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                Text(category.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    category.description,
                    modifier = Modifier.padding(top = 3.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForwardIos,
                contentDescription = "进入${category.title}",
                modifier = Modifier.size(17.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun GeneralSettingsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val onAudioMixingChanged = rememberHapticValueChange(viewModel::updateAllowAudioMixing)
    val onHapticFeedbackChanged = rememberHapticValueChange(viewModel::updateHapticFeedbackEnabled)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.VolumeUp, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        Text("允许与其他应用同时播放", fontWeight = FontWeight.SemiBold)
                        Text(
                            "开启后不再请求音频焦点，本应用不会主动暂停或压低其他媒体的音量。",
                            modifier = Modifier.padding(top = 4.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    androidx.compose.material3.Switch(
                        checked = state.allowAudioMixing,
                        onCheckedChange = onAudioMixingChanged,
                    )
                }
            }
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Vibration, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        Text("触感反馈", fontWeight = FontWeight.SemiBold)
                        Text(
                            "点击按钮和可操作卡片时提供轻微震动反馈。",
                            modifier = Modifier.padding(top = 4.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    androidx.compose.material3.Switch(
                        checked = state.hapticFeedbackEnabled,
                        onCheckedChange = onHapticFeedbackChanged,
                    )
                }
            }
        }
    }
}
