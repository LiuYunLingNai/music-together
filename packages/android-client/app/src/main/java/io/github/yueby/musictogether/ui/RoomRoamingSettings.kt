package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.AppState
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

private data class RoamingOption(val value: String, val label: String, val description: String)

private val roamingSources = listOf(
    RoamingOption("netease", "网易云音乐", "使用房主的网易云私人漫游"),
    RoamingOption("tencent", "QQ音乐", "使用房主的 QQ 音乐个性化推荐"),
    RoamingOption("kugou", "酷狗音乐", "使用房主的酷狗个性化推荐"),
    RoamingOption("kugou_concept", "酷狗概念版", "使用房主的酷狗概念版推荐"),
)

private val roamingModes = listOf(
    RoamingOption("DEFAULT", "默认漫游", "综合听歌记录，常规个性化推荐"),
    RoamingOption("FAMILIAR", "熟悉模式", "多推收藏、常听与相似曲风"),
    RoamingOption("EXPLORE", "探索模式", "多推新歌、冷门歌，拓展曲库"),
    RoamingOption("SCENE_RCMD:EXERCISE", "运动场景", "节奏明快，适合锻炼"),
    RoamingOption("SCENE_RCMD:FOCUS", "专注场景", "适合工作、学习，偏轻音乐"),
    RoamingOption("SCENE_RCMD:NIGHT_EMO", "深夜场景", "夜晚情绪向慢歌"),
    RoamingOption("aidj", "AI DJ", "AI 串烧混剪，曲间带过渡衔接"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MaterialRoomRoamingSettings(
    state: AppState,
    canManage: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    onSourceChange: (String) -> Unit,
    onModeChange: (String) -> Unit,
) {
    val room = state.room ?: return
    val ownerLoginStatus = ownerLoginStatus(state, room.roamingSource)
    val source = roamingSources.firstOrNull { it.value == room.roamingSource } ?: roamingSources.first()
    val mode = roamingModes.firstOrNull { it.value == room.roamingMode } ?: roamingModes.first()
    val canToggle = canManage && (room.roamingEnabled || ownerLoginStatus != false)
    var sourceExpanded by remember { mutableStateOf(false) }
    var modeExpanded by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        HorizontalDivider()
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("私人漫游", fontWeight = FontWeight.SemiBold)
                Text(
                    when (ownerLoginStatus) {
                        false -> "请先登录房主的${source.label}账号"
                        else -> "队列没有下一首时，使用房主账号继续个性化推荐"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = room.roamingEnabled, onCheckedChange = onEnabledChange, enabled = canToggle)
        }
        ExposedDropdownMenuBox(
            expanded = sourceExpanded,
            onExpandedChange = { if (canManage) sourceExpanded = it },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = source.label,
                onValueChange = {},
                label = { Text("漫游平台") },
                supportingText = { Text("个性化推荐只使用房主自己的平台账号") },
                readOnly = true,
                enabled = canManage,
                modifier = Modifier.fillMaxWidth().menuAnchor(),
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(sourceExpanded) },
            )
            ExposedDropdownMenu(expanded = sourceExpanded, onDismissRequest = { sourceExpanded = false }) {
                roamingSources.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        onClick = {
                            sourceExpanded = false
                            onSourceChange(option.value)
                        },
                    )
                }
            }
        }
        ExposedDropdownMenuBox(
            expanded = modeExpanded,
            onExpandedChange = { if (canManage && room.roamingSource == "netease") modeExpanded = it },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = if (room.roamingSource == "netease") mode.label else "默认漫游",
                onValueChange = {},
                label = { Text("漫游模式") },
                supportingText = {
                    Text(if (room.roamingSource == "netease") mode.description else "该平台目前固定使用默认推荐")
                },
                readOnly = true,
                enabled = canManage && room.roamingSource == "netease",
                modifier = Modifier.fillMaxWidth().menuAnchor(),
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(modeExpanded) },
            )
            ExposedDropdownMenu(expanded = modeExpanded, onDismissRequest = { modeExpanded = false }) {
                roamingModes.forEach { option ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(option.label)
                                Text(
                                    option.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        },
                        onClick = {
                            modeExpanded = false
                            onModeChange(option.value)
                        },
                    )
                }
            }
        }
    }
}

@Composable
internal fun MiuixRoomRoamingSettings(
    state: AppState,
    canManage: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    onSourceChange: (String) -> Unit,
    onModeChange: (String) -> Unit,
) {
    val room = state.room ?: return
    val ownerLoginStatus = ownerLoginStatus(state, room.roamingSource)
    val sourceIndex = roamingSources.indexOfFirst { it.value == room.roamingSource }.coerceAtLeast(0)
    val modeIndex = roamingModes.indexOfFirst { it.value == room.roamingMode }.coerceAtLeast(0)
    val source = roamingSources[sourceIndex]
    MiuixCard(Modifier.fillMaxWidth()) {
        SwitchPreference(
            title = "私人漫游",
            summary = if (ownerLoginStatus == false) {
                "请先登录房主的${source.label}账号"
            } else {
                "队列没有下一首时继续个性化推荐"
            },
            checked = room.roamingEnabled,
            enabled = canManage && (room.roamingEnabled || ownerLoginStatus != false),
            onCheckedChange = onEnabledChange,
            startAction = { MiuixIcon(Icons.Default.AutoAwesome, null, tint = MiuixTheme.colorScheme.primary) },
        )
        WindowDropdownPreference(
            title = "漫游平台",
            summary = "只使用房主自己的平台账号",
            items = roamingSources.map { it.label },
            selectedIndex = sourceIndex,
            enabled = canManage,
            onSelectedIndexChange = { index -> roamingSources.getOrNull(index)?.let { onSourceChange(it.value) } },
        )
        WindowDropdownPreference(
            title = "漫游模式",
            summary = if (room.roamingSource == "netease") {
                roamingModes[modeIndex].description
            } else {
                "该平台目前固定使用默认推荐"
            },
            items = roamingModes.map { it.label },
            selectedIndex = if (room.roamingSource == "netease") modeIndex else 0,
            enabled = canManage && room.roamingSource == "netease",
            onSelectedIndexChange = { index -> roamingModes.getOrNull(index)?.let { onModeChange(it.value) } },
        )
    }
}

private fun ownerLoginStatus(state: AppState, source: String): Boolean? {
    val room = state.room ?: return null
    if (state.userId != room.creatorId || !state.platformHub.statusLoaded) return null
    return state.platformHub.myAuth.any { it.platform == source && it.loggedIn }
}
