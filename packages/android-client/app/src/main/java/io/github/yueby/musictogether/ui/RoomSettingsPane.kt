package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.audioQualityLabel
import io.github.yueby.musictogether.model.availableAudioQualities

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomSettingsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val room = state.room ?: return
    val canManage = room.users.firstOrNull { it.id == state.userId }?.role == "owner" ||
        state.accountProfile?.role == "admin"
    val options = remember(state.platformHub.authStatus) { availableAudioQualities(state.platformHub.authStatus) }
    var expanded by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Text("房间设置", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "${room.name} · ${room.id}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontFamily = FontFamily.Monospace,
            )
        }
        item { HorizontalDivider() }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.GraphicEq, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("播放音质", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (canManage) "切换后对下一首歌生效" else "仅房主或服务器管理员可修改",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { if (canManage) expanded = it },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                OutlinedTextField(
                    value = audioQualityLabel(room.audioQuality),
                    onValueChange = {},
                    readOnly = true,
                    enabled = canManage,
                    modifier = Modifier.fillMaxWidth().menuAnchor(),
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                )
                ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    options.forEach { option ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(option.label)
                                    option.description?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            },
                            onClick = {
                                expanded = false
                                viewModel.updateRoomAudioQuality(option.value)
                            },
                        )
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.PushPin, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("永久房间", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (room.permanent) "空房不回收，服务重启后仍会保留" else "空置一分钟后自动回收",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = room.permanent,
                    onCheckedChange = viewModel::updateRoomPermanent,
                    enabled = canManage,
                )
            }
        }
        item {
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(10.dp))
                Text(
                    "高音质取决于对应平台账号的 VIP 权限、Cookie 有效期、地区和接口可用性；服务端会在不可用时自动回退。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
