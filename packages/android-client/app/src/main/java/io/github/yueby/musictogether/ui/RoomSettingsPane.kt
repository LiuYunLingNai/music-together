package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.AudioLines
import com.composables.icons.lucide.EyeOff
import com.composables.icons.lucide.Gauge
import com.composables.icons.lucide.Pin
import com.composables.icons.lucide.RefreshCcw
import com.composables.icons.lucide.Timer
import top.yukonga.miuix.kmp.utils.overScrollVertical
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import io.github.yueby.musictogether.ui.designsystem.AppButton
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.availableAudioQualities
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.SmallTitle as MiuixSmallTitle
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.SliderPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import kotlin.math.roundToInt

@Composable
fun RoomSettingsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val room = state.room ?: return
    val currentUser = room.users.firstOrNull { it.id == state.userId }
    val permissions = roomSettingsPermissions(
        role = currentUser?.role,
        isServerAdmin = currentUser?.isServerAdmin == true || state.accountProfile?.role == "admin",
    )
    MiuixRoomSettingsPane(state, permissions, viewModel)
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
        modifier = Modifier.fillMaxSize().overScrollVertical(),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        item {
            MiuixCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    MiuixText(room.name, style = MiuixTheme.textStyles.title3, fontWeight = FontWeight.SemiBold)
                    MiuixText(
                        buildString {
                            append("房间号 ").append(room.id).append(" · ").append(room.users.size).append(" 人在线")
                            if (room.hasPassword) append(" · 需要密码")
                            if (room.hidden) append(" · 已隐藏")
                        },
                        style = MiuixTheme.textStyles.body2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppButton("分享房间", viewModel::openRoomShare, modifier = Modifier.weight(1f))
                        AppButton("复制链接", viewModel::copyRoomLink, modifier = Modifier.weight(1f), primary = false)
                    }
                }
            }
        }
        item {
            MiuixSmallTitle(text = "同步状态")
            MiuixCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                SliderPreference(
                    value = state.syncPacketIntervalSeconds.toFloat(),
                    onValueChange = { viewModel.updateSyncPacketInterval(it.roundToInt()) },
                    title = "同步数据间隔",
                    summary = "时钟数据包和播放校准包的发送间隔",
                    valueText = "${state.syncPacketIntervalSeconds} 秒",
                    valueRange = 1f..60f,
                    steps = 58,
                    startAction = { MiuixIcon(Lucide.Timer, null, tint = MiuixTheme.colorScheme.primary) },
                )
                ArrowPreference(
                    title = "同步偏移",
                    summary = if (syncDriftMs > 0) "+${syncDriftMs}ms" else "${syncDriftMs}ms",
                    startAction = { MiuixIcon(Lucide.RefreshCcw, null, tint = MiuixTheme.colorScheme.primary) },
                )
            }
        }
        item {
            MiuixSmallTitle(text = "播放与同步")
            MiuixCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                SwitchPreference(
                    title = "自动变速校准",
                    summary = "以最多 ±1% 的速度差平滑消除本机播放偏移",
                    checked = state.playbackTempoSyncEnabled,
                    onCheckedChange = viewModel::updatePlaybackTempoSync,
                    startAction = { MiuixIcon(Lucide.Gauge, null, tint = MiuixTheme.colorScheme.primary) },
                )
                if (!state.playbackTempoSyncEnabled) {
                    SwitchPreference(
                        title = "大偏差直接同步",
                        summary = "连续确认明显漂移后直接定位",
                        checked = state.playbackHardSeekSyncEnabled,
                        onCheckedChange = viewModel::updatePlaybackHardSeekSync,
                        startAction = { MiuixIcon(Lucide.RefreshCcw, null, tint = MiuixTheme.colorScheme.primary) },
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
                    startAction = { MiuixIcon(Lucide.AudioLines, null, tint = MiuixTheme.colorScheme.primary) },
                )
            }
        }
        item {
            MiuixSmallTitle(text = "房间可见性与权限")
            MiuixCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                SwitchPreference(
                    title = "隐藏房间",
                    summary = if (room.hidden) "不在公开大厅显示" else "当前显示在公开大厅",
                    checked = room.hidden,
                    enabled = permissions.canManageAllSettings,
                    onCheckedChange = viewModel::updateRoomHidden,
                    startAction = { MiuixIcon(Lucide.EyeOff, null, tint = MiuixTheme.colorScheme.primary) },
                )
                SwitchPreference(
                    title = "永久房间",
                    summary = if (room.permanent) "空房不会自动回收" else "空置一分钟后自动回收",
                    checked = room.permanent,
                    enabled = permissions.canManageAllSettings,
                    onCheckedChange = viewModel::updateRoomPermanent,
                    startAction = { MiuixIcon(Lucide.Pin, null, tint = MiuixTheme.colorScheme.primary) },
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
        item {
            MiuixSmallTitle(text = "私人漫游")
            Column(Modifier.padding(horizontal = 12.dp)) {
                MiuixRoomRoamingSettings(
                    state = state,
                    canManage = permissions.canManageAllSettings,
                    onEnabledChange = viewModel::updateRoamingEnabled,
                    onSourceChange = viewModel::updateRoamingSource,
                    onModeChange = viewModel::updateRoamingMode,
                )
            }
        }
    }
}
