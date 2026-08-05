package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RoomHeader(
    room: RoomState,
    immersive: Boolean,
    safeContentPadding: PaddingValues = PaddingValues(0.dp),
    menuExpanded: Boolean,
    onMenuExpandedChange: (Boolean) -> Unit,
    connectionStatus: ConnectionStatus,
    pingMs: Long?,
    viewModel: MusicTogetherViewModel,
    context: android.content.Context,
    onMinimizePlayer: (() -> Unit)? = null,
    onOpenOverlay: (RoomOverlay) -> Unit,
) {
    val layoutDirection = LocalLayoutDirection.current
    val safeTop = if (immersive) safeContentPadding.calculateTopPadding() else 0.dp
    val safeStart =
        if (immersive) safeContentPadding.calculateLeftPadding(layoutDirection) else 0.dp
    val safeEnd =
        if (immersive) safeContentPadding.calculateRightPadding(layoutDirection) else 0.dp
    val contentColor =
        if (immersive) Color.White.copy(alpha = 0.92f) else MaterialTheme.colorScheme.onSurface
    val secondaryColor =
        if (immersive) Color.White.copy(alpha = 0.74f) else MaterialTheme.colorScheme.onSurfaceVariant
    val connected = connectionStatus == ConnectionStatus.Connected
    val latencyColor = when {
        !connected -> MaterialTheme.colorScheme.error
        pingMs == null -> secondaryColor
        pingMs < 100 -> if (immersive) Color(0xFF86EFAC) else Color(0xFF15803D)
        pingMs < 300 -> if (immersive) Color(0xFFFDE68A) else Color(0xFFB45309)
        else -> MaterialTheme.colorScheme.error
    }
    val dividerColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.50f)
    val backgroundModifier =
        if (immersive) {
            Modifier.background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.70f),
                    0.72f to Color.Black.copy(alpha = 0.34f),
                    1f to Color.Transparent,
                ),
            )
        } else {
            Modifier
                .background(MaterialTheme.colorScheme.background.copy(alpha = 0.95f))
                .drawWithContent {
                    drawContent()
                    drawLine(
                        color = dividerColor,
                        start = androidx.compose.ui.geometry.Offset(0f, size.height - 1f),
                        end = androidx.compose.ui.geometry.Offset(size.width, size.height - 1f),
                        strokeWidth = 1f,
                    )
                }
        }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(if (immersive) 64.dp + safeTop else 56.dp)
            .then(backgroundModifier)
            .padding(
                start = (if (immersive) 18.dp else 8.dp) + safeStart,
                top = safeTop,
                end = (if (immersive) 24.dp else 8.dp) + safeEnd,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = room.name,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            fontSize = if (immersive) 16.sp else 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = contentColor,
        )
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable { onOpenOverlay(RoomOverlay.Members) }
                .padding(horizontal = 6.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Icon(
                Icons.Default.Groups,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = secondaryColor,
            )
            Text(
                room.users.size.toString(),
                fontSize = 12.sp,
                color = secondaryColor,
            )
            if (room.hasPassword) {
                Icon(
                    Icons.Default.Lock,
                    contentDescription = "密码房间",
                    modifier = Modifier.size(14.dp),
                    tint = secondaryColor,
                )
            }
        }
        Spacer(Modifier.size(6.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Icon(
                if (connected) Icons.Default.Wifi else Icons.Default.WifiOff,
                contentDescription = if (connected) "网络延迟" else "连接已断开",
                modifier = Modifier.size(16.dp),
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
        Spacer(Modifier.size(2.dp))
        if (connected) {
            IconButton(onClick = { onOpenOverlay(RoomOverlay.Recommendations) }) {
                Icon(Icons.Default.AutoAwesome, "推荐点歌", Modifier.size(20.dp), tint = contentColor)
            }
        }
        IconButton(onClick = { onOpenOverlay(RoomOverlay.Search) }) {
            Icon(Icons.Default.Search, "搜索点歌", Modifier.size(20.dp), tint = contentColor)
        }
        onMinimizePlayer?.let { minimize ->
            IconButton(onClick = minimize) {
                Icon(Icons.Default.KeyboardArrowDown, "返回主页", Modifier.size(24.dp), tint = contentColor)
            }
        }
        IconButton(onClick = { onMenuExpandedChange(true) }) {
            Icon(Icons.Default.MoreVert, "更多操作", Modifier.size(20.dp), tint = contentColor)
        }
    }

    if (menuExpanded) {
        ModalBottomSheet(onDismissRequest = { onMenuExpandedChange(false) }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp),
            ) {
                Text(
                    text = "更多操作",
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                RoomMenuAction(Icons.Default.AccountCircle, "个人账号") {
                    onMenuExpandedChange(false)
                    onOpenOverlay(RoomOverlay.AccountSettings)
                }
                RoomMenuAction(Icons.Default.Settings, "房间与音质") {
                    onMenuExpandedChange(false)
                    onOpenOverlay(RoomOverlay.RoomSettings)
                }
                RoomMenuAction(Icons.Default.ContentCopy, "复制房间链接") {
                    onMenuExpandedChange(false)
                    viewModel.copyRoomLink()
                }
                RoomMenuAction(Icons.Default.MusicNote, "音源账号与歌单") {
                    onMenuExpandedChange(false)
                    onOpenOverlay(RoomOverlay.Accounts)
                }
                if (BuildConfig.DEBUG) {
                    HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                    Text(
                        text = "调试",
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    RoomMenuAction(Icons.Default.BugReport, "导出日志") {
                        onMenuExpandedChange(false)
                        AppLogger.export(context)
                    }
                    RoomMenuAction(Icons.Default.BugReport, "清空日志") {
                        onMenuExpandedChange(false)
                        viewModel.clearLogs()
                    }
                }
                HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                RoomMenuAction(
                    icon = Icons.AutoMirrored.Filled.Logout,
                    label = "离开房间",
                    color = MaterialTheme.colorScheme.error,
                ) {
                    onMenuExpandedChange(false)
                    viewModel.leaveRoom()
                }
            }
        }
    }
}

@Composable
private fun RoomMenuAction(
    icon: ImageVector,
    label: String,
    color: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = color)
        Text(text = label, style = MaterialTheme.typography.bodyLarge, color = color)
    }
}

@Composable
internal fun LandscapeRoomSidePanel(
    overlay: RoomOverlay,
    room: RoomState,
    messages: List<ChatMessage>,
    viewModel: MusicTogetherViewModel,
    safeContentPadding: PaddingValues,
    onDismiss: () -> Unit,
) {
    val layoutDirection = LocalLayoutDirection.current
    val safeTop = safeContentPadding.calculateTopPadding()
    val safeBottom = safeContentPadding.calculateBottomPadding()
    val safeEnd = safeContentPadding.calculateRightPadding(layoutDirection)
    val panelInteraction = remember { MutableInteractionSource() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.34f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss,
            ),
    ) {
        Surface(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxWidth(0.48f)
                .widthIn(min = 320.dp, max = 460.dp)
                .fillMaxHeight()
                .padding(
                    top = safeTop + 8.dp,
                    end = safeEnd + 8.dp,
                    bottom = safeBottom + 8.dp,
                )
                .clickable(
                    interactionSource = panelInteraction,
                    indication = null,
                    onClick = {},
                ),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
            tonalElevation = 8.dp,
            shadowElevation = 18.dp,
        ) {
            when (overlay) {
                RoomOverlay.Queue -> QueuePane(room, viewModel, onClose = onDismiss)
                RoomOverlay.Chat -> ChatPane(messages, viewModel, onClose = onDismiss)
                else -> Unit
            }
        }
    }
}
