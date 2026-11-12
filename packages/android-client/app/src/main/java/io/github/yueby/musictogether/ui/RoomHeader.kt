package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ChevronDown
import com.composables.icons.lucide.Copy
import com.composables.icons.lucide.Download
import com.composables.icons.lucide.EllipsisVertical
import com.composables.icons.lucide.Flame
import com.composables.icons.lucide.ListMusic
import com.composables.icons.lucide.Lock
import com.composables.icons.lucide.LogOut
import com.composables.icons.lucide.Music
import com.composables.icons.lucide.Search
import com.composables.icons.lucide.Settings
import com.composables.icons.lucide.Share2
import com.composables.icons.lucide.SlidersHorizontal
import com.composables.icons.lucide.Sparkles
import com.composables.icons.lucide.Users
import com.composables.icons.lucide.Wifi
import com.composables.icons.lucide.WifiOff
import io.github.yueby.musictogether.ui.player.DropdownMenuItem
import io.github.yueby.musictogether.ui.player.DropdownMenu
import io.github.yueby.musictogether.ui.player.PlayerChatButton
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomState
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

internal val RoomHeaderHeight = 56.dp

@Composable
internal fun RoomHeader(
    room: RoomState,
    safeContentPadding: PaddingValues,
    menuExpanded: Boolean,
    onMenuExpandedChange: (Boolean) -> Unit,
    connectionStatus: ConnectionStatus,
    pingMs: Long?,
    viewModel: MusicTogetherViewModel,
    onMinimizePlayer: (() -> Unit)? = null,
    onOpenMembers: () -> Unit,
    onOpenRoute: (AppRoute) -> Unit,
    chatUnreadCount: Int = 0,
    onOpenLyricCalibration: (() -> Unit)? = null,
) {
    val layoutDirection = LocalLayoutDirection.current
    val safeTop = safeContentPadding.calculateTopPadding()
    val safeStart = safeContentPadding.calculateLeftPadding(layoutDirection)
    val safeEnd = safeContentPadding.calculateRightPadding(layoutDirection)
    val contentColor = Color.White.copy(alpha = 0.92f)
    val secondaryColor = Color.White.copy(alpha = 0.74f)
    val connected = connectionStatus == ConnectionStatus.Connected
    val latencyColor = when {
        !connected -> MiuixTheme.colorScheme.error
        pingMs == null -> secondaryColor
        pingMs < 100 -> Color(0xFF86EFAC)
        pingMs < 300 -> Color(0xFFFDE68A)
        else -> MiuixTheme.colorScheme.error
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(RoomHeaderHeight + safeTop)
            .padding(start = 4.dp + safeStart, top = safeTop, end = 4.dp + safeEnd),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        onMinimizePlayer?.let { minimize ->
            IconButton(onClick = minimize) {
                Icon(Lucide.ChevronDown, "返回主页", Modifier.size(28.dp), tint = contentColor)
            }
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(12.dp))
                .clickable(onClick = onOpenMembers)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            Text(
                text = room.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = contentColor,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(Lucide.Users, contentDescription = null, modifier = Modifier.size(13.dp), tint = secondaryColor)
                Text(room.users.size.toString(), fontSize = 11.sp, color = secondaryColor)
                if (room.hasPassword) {
                    Icon(Lucide.Lock, contentDescription = "密码房间", modifier = Modifier.size(12.dp), tint = secondaryColor)
                }
                Spacer(Modifier.size(4.dp))
                Icon(
                    if (connected) Lucide.Wifi else Lucide.WifiOff,
                    contentDescription = if (connected) "网络延迟" else "连接已断开",
                    modifier = Modifier.size(13.dp),
                    tint = latencyColor,
                )
                Text(
                    text = if (connected) pingMs?.let { "${it}ms" } ?: "--ms" else "--",
                    color = latencyColor,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    fontSize = 11.sp,
                    maxLines = 1,
                )
            }
        }
        PlayerChatButton(
            unreadCount = chatUnreadCount,
            onClick = { onOpenRoute(AppRoute.Chat) },
            iconAlpha = 0.92f,
        )
        if (connected) {
            IconButton(onClick = { onOpenRoute(AppRoute.Recommendations) }) {
                Icon(Lucide.Sparkles, "推荐点歌", Modifier.size(20.dp), tint = contentColor)
            }
        }
        IconButton(onClick = { onOpenRoute(AppRoute.Search) }) {
            Icon(Lucide.Search, "搜索点歌", Modifier.size(20.dp), tint = contentColor)
        }
        Box {
            IconButton(onClick = { onMenuExpandedChange(true) }) {
                Icon(Lucide.EllipsisVertical, "更多操作", Modifier.size(20.dp), tint = contentColor)
            }
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { onMenuExpandedChange(false) }) {
                fun act(block: () -> Unit) {
                    onMenuExpandedChange(false)
                    block()
                }
                RoomMenuItem(Lucide.ListMusic, "播放队列") { act { onOpenRoute(AppRoute.Queue) } }
                RoomMenuItem(Lucide.Flame, "热歌榜") { act { onOpenRoute(AppRoute.HotSongs) } }
                onOpenLyricCalibration?.let { open -> RoomMenuItem(Lucide.SlidersHorizontal, "歌词校准") { act(open) } }
                RoomMenuItem(Lucide.Settings, "房间与同步") { act { onOpenRoute(AppRoute.RoomInfo) } }
                RoomMenuItem(Lucide.Share2, "分享房间") { act(viewModel::openRoomShare) }
                RoomMenuItem(Lucide.Copy, "复制房间链接") { act(viewModel::copyRoomLink) }
                RoomMenuItem(Lucide.Music, "音乐平台账号") { act { onOpenRoute(AppRoute.PlatformAccounts) } }
                if (room.currentTrack != null) {
                    RoomMenuItem(Lucide.Download, "下载当前歌曲") { act { onOpenRoute(AppRoute.Download) } }
                }
                RoomMenuItem(Lucide.LogOut, "离开房间", MiuixTheme.colorScheme.error) {
                    act(viewModel::leaveRoom)
                }
            }
        }
    }
}

@Composable
private fun RoomMenuItem(icon: ImageVector, label: String, color: Color? = null, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = color ?: MiuixTheme.colorScheme.onSurface) },
        leadingIcon = { Icon(icon, null, tint = color ?: MiuixTheme.colorScheme.onSurface) },
        onClick = onClick,
    )
}
