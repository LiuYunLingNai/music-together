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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.model.audioQualityLabel
import io.github.yueby.musictogether.model.availableAudioQualities
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.SmallTitle as MiuixSmallTitle
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.SliderPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import kotlin.math.abs
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomSettingsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val room = state.room ?: return
    val currentUser = room.users.firstOrNull { it.id == state.userId }
    val permissions = roomSettingsPermissions(
        role = currentUser?.role,
        isServerAdmin = currentUser?.isServerAdmin == true || state.accountProfile?.role == "admin",
    )
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixRoomSettingsPane(state, permissions, viewModel)
        return
    }
    val options = remember { availableAudioQualities() }
    var expanded by remember { mutableStateOf(false) }
    var syncIntervalDraft by remember(state.syncPacketIntervalSeconds) {
        mutableStateOf(state.syncPacketIntervalSeconds.toString())
    }
    val syncDriftMs = (state.syncDriftSeconds * 1000).roundToInt()
    val syncDriftLabel = if (syncDriftMs > 0) "+${syncDriftMs}ms" else "${syncDriftMs}ms"
    val commitSyncInterval = {
        val value = syncIntervalDraft.toIntOrNull()?.coerceIn(1, 60) ?: state.syncPacketIntervalSeconds
        syncIntervalDraft = value.toString()
        viewModel.updateSyncPacketInterval(value)
    }

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
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Default.Timer, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("同步数据间隔", fontWeight = FontWeight.SemiBold)
                    Text(
                        "时钟数据包和播放进度校准包的发送间隔，可设置为 1–60 秒。间隔越长，网络请求越少，但校准响应会稍慢。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.padding(top = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(
                            onClick = { viewModel.updateSyncPacketInterval(state.syncPacketIntervalSeconds - 1) },
                            enabled = state.syncPacketIntervalSeconds > 1,
                        ) {
                            Icon(Icons.Default.Remove, "减少同步数据间隔")
                        }
                        OutlinedTextField(
                            value = syncIntervalDraft,
                            onValueChange = { value ->
                                if (value.isEmpty() || value.all(Char::isDigit)) syncIntervalDraft = value.take(2)
                            },
                            modifier = Modifier
                                .width(104.dp)
                                .onFocusChanged { if (!it.isFocused) commitSyncInterval() },
                            singleLine = true,
                            suffix = { Text("秒") },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(onDone = { commitSyncInterval() }),
                        )
                        IconButton(
                            onClick = { viewModel.updateSyncPacketInterval(state.syncPacketIntervalSeconds + 1) },
                            enabled = state.syncPacketIntervalSeconds < 60,
                        ) {
                            Icon(Icons.Default.Add, "增加同步数据间隔")
                        }
                    }
                }
            }
        }
        item { HorizontalDivider() }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Sync, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Text("同步偏移", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                Text(
                    syncDriftLabel,
                    color = if (abs(syncDriftMs) > 500) {
                        MaterialTheme.colorScheme.tertiary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
        item { HorizontalDivider() }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Speed, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("自动变速校准", fontWeight = FontWeight.SemiBold)
                    Text(
                        "不改变音高，以最多 ±1% 的速度差平滑消除本机播放偏移；关闭后保持 1.0× 原速，并可单独选择是否直接定位大幅偏移。但是开启后有可能导致音质变差",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = state.playbackTempoSyncEnabled,
                    onCheckedChange = viewModel::updatePlaybackTempoSync,
                )
            }
        }
        if (!state.playbackTempoSyncEnabled) {
            item { HorizontalDivider() }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Sync, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("大偏差直接同步", fontWeight = FontWeight.SemiBold)
                        Text(
                            "偏移连续两次超过动态阈值后直接定位；阈值最低为 500ms，高延迟时会提高到中位 RTT + 250ms。如果你的网络环境(延迟)不好 开启后可能导致一直同步导致体验不佳",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = state.playbackHardSeekSyncEnabled,
                        onCheckedChange = viewModel::updatePlaybackHardSeekSync,
                    )
                }
            }
        }
        item { HorizontalDivider() }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.GraphicEq, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("播放音质", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (permissions.canAdjustAudioQuality) {
                            "切换后对下一首歌生效"
                        } else {
                            "仅房主、房间管理员或服务器管理员可修改"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { if (permissions.canAdjustAudioQuality) expanded = it },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                OutlinedTextField(
                    value = audioQualityLabel(room.audioQuality),
                    onValueChange = {},
                    readOnly = true,
                    enabled = permissions.canAdjustAudioQuality,
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
                Icon(Icons.Default.VisibilityOff, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("隐藏房间", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (room.hidden) "不在公开大厅显示，仍可通过房间号或邀请链接加入" else "当前显示在公开大厅",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = room.hidden,
                    onCheckedChange = viewModel::updateRoomHidden,
                    enabled = permissions.canManageAllSettings,
                )
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.PushPin, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("永久房间", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (room.permanent) "无论公开或隐藏，空房均不回收" else "空置一分钟后自动回收",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = room.permanent,
                    onCheckedChange = viewModel::updateRoomPermanent,
                    enabled = permissions.canManageAllSettings,
                )
            }
        }
        if (permissions.canManageAllSettings) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("临时管理员删除单曲", fontWeight = FontWeight.SemiBold)
                        Text(
                            "允许临时管理员从播放列表删除单首歌曲",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = room.allowTemporaryAdminTrackRemoval,
                        onCheckedChange = viewModel::updateTemporaryAdminTrackRemoval,
                    )
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("临时管理员清空歌单", fontWeight = FontWeight.SemiBold)
                        Text(
                            "允许临时管理员清空整个播放列表",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = room.allowTemporaryAdminQueueClear,
                        onCheckedChange = viewModel::updateTemporaryAdminQueueClear,
                    )
                }
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

@Composable
private fun MiuixRoomSettingsPane(
    state: AppState,
    permissions: RoomSettingsPermissions,
    viewModel: MusicTogetherViewModel,
) {
    val room = state.room ?: return
    val qualityOptions = remember { availableAudioQualities() }
    val selectedQuality = qualityOptions.indexOfFirst { it.value == room.audioQuality }.coerceAtLeast(0)
    val syncDriftMs = (state.syncDriftSeconds * 1000).roundToInt()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            MiuixSmallTitle(text = "${room.name} · ${room.id}")
            MiuixCard(Modifier.fillMaxWidth()) {
                SliderPreference(
                    value = state.syncPacketIntervalSeconds.toFloat(),
                    onValueChange = { viewModel.updateSyncPacketInterval(it.roundToInt()) },
                    title = "同步数据间隔",
                    summary = "时钟数据包和播放校准包的发送间隔",
                    valueText = "${state.syncPacketIntervalSeconds} 秒",
                    valueRange = 1f..60f,
                    steps = 58,
                    startAction = { MiuixIcon(Icons.Default.Timer, null, tint = MiuixTheme.colorScheme.primary) },
                )
                ArrowPreference(
                    title = "同步偏移",
                    summary = if (syncDriftMs > 0) "+${syncDriftMs}ms" else "${syncDriftMs}ms",
                    startAction = { MiuixIcon(Icons.Default.Sync, null, tint = MiuixTheme.colorScheme.primary) },
                )
            }
        }
        item {
            MiuixSmallTitle(text = "播放与同步")
            MiuixCard(Modifier.fillMaxWidth()) {
                SwitchPreference(
                    title = "自动变速校准",
                    summary = "以最多 ±1% 的速度差平滑消除本机播放偏移",
                    checked = state.playbackTempoSyncEnabled,
                    onCheckedChange = viewModel::updatePlaybackTempoSync,
                    startAction = { MiuixIcon(Icons.Default.Speed, null, tint = MiuixTheme.colorScheme.primary) },
                )
                if (!state.playbackTempoSyncEnabled) {
                    SwitchPreference(
                        title = "大偏差直接同步",
                        summary = "连续确认明显漂移后直接定位",
                        checked = state.playbackHardSeekSyncEnabled,
                        onCheckedChange = viewModel::updatePlaybackHardSeekSync,
                        startAction = { MiuixIcon(Icons.Default.Sync, null, tint = MiuixTheme.colorScheme.primary) },
                    )
                }
                WindowDropdownPreference(
                    title = "播放音质",
                    summary = if (permissions.canAdjustAudioQuality) "切换后对下一首歌生效" else "当前账号无修改权限",
                    items = qualityOptions.map { it.label },
                    selectedIndex = selectedQuality,
                    enabled = permissions.canAdjustAudioQuality,
                    onSelectedIndexChange = { index ->
                        qualityOptions.getOrNull(index)?.let { viewModel.updateRoomAudioQuality(it.value) }
                    },
                    startAction = { MiuixIcon(Icons.Default.GraphicEq, null, tint = MiuixTheme.colorScheme.primary) },
                )
            }
        }
        item {
            MiuixSmallTitle(text = "房间可见性与权限")
            MiuixCard(Modifier.fillMaxWidth()) {
                SwitchPreference(
                    title = "隐藏房间",
                    summary = if (room.hidden) "不在公开大厅显示" else "当前显示在公开大厅",
                    checked = room.hidden,
                    enabled = permissions.canManageAllSettings,
                    onCheckedChange = viewModel::updateRoomHidden,
                    startAction = { MiuixIcon(Icons.Default.VisibilityOff, null, tint = MiuixTheme.colorScheme.primary) },
                )
                SwitchPreference(
                    title = "永久房间",
                    summary = if (room.permanent) "空房不会自动回收" else "空置一分钟后自动回收",
                    checked = room.permanent,
                    enabled = permissions.canManageAllSettings,
                    onCheckedChange = viewModel::updateRoomPermanent,
                    startAction = { MiuixIcon(Icons.Default.PushPin, null, tint = MiuixTheme.colorScheme.primary) },
                )
                if (permissions.canManageAllSettings) {
                    SwitchPreference(
                        title = "临时管理员删除单曲",
                        summary = "允许临时管理员删除播放列表中的单曲",
                        checked = room.allowTemporaryAdminTrackRemoval,
                        onCheckedChange = viewModel::updateTemporaryAdminTrackRemoval,
                    )
                    SwitchPreference(
                        title = "临时管理员清空歌单",
                        summary = "允许临时管理员清空整个播放列表",
                        checked = room.allowTemporaryAdminQueueClear,
                        onCheckedChange = viewModel::updateTemporaryAdminQueueClear,
                    )
                }
            }
        }
    }
}
