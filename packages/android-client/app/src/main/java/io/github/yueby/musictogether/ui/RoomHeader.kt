package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import io.github.yueby.musictogether.model.RoomState

@Composable
internal fun RoomHeader(
    room: RoomState,
    immersive: Boolean,
    safeContentPadding: PaddingValues = PaddingValues(0.dp),
    menuExpanded: Boolean,
    onMenuExpandedChange: (Boolean) -> Unit,
    viewModel: MusicTogetherViewModel,
    context: android.content.Context,
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
        IconButton(onClick = { onOpenOverlay(RoomOverlay.Search) }) {
            Icon(Icons.Default.Search, "搜索点歌", Modifier.size(20.dp), tint = contentColor)
        }
        Box {
            IconButton(onClick = { onMenuExpandedChange(true) }) {
                Icon(Icons.Default.MoreVert, "更多操作", Modifier.size(20.dp), tint = contentColor)
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { onMenuExpandedChange(false) },
            ) {
                DropdownMenuItem(
                    text = { Text("个人账号") },
                    onClick = {
                        onMenuExpandedChange(false)
                        onOpenOverlay(RoomOverlay.AccountSettings)
                    },
                )
                DropdownMenuItem(
                    text = { Text("房间与音质") },
                    onClick = {
                        onMenuExpandedChange(false)
                        onOpenOverlay(RoomOverlay.RoomSettings)
                    },
                )
                DropdownMenuItem(
                    leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                    text = { Text("复制房间链接") },
                    onClick = {
                        onMenuExpandedChange(false)
                        viewModel.copyRoomLink()
                    },
                )
                DropdownMenuItem(
                    text = { Text("音源账号与歌单") },
                    onClick = {
                        onMenuExpandedChange(false)
                        onOpenOverlay(RoomOverlay.Accounts)
                    },
                )
                if (BuildConfig.DEBUG) {
                    DropdownMenuItem(
                        text = { Text("导出日志") },
                        onClick = {
                            onMenuExpandedChange(false)
                            AppLogger.export(context)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("清空日志") },
                        onClick = {
                            onMenuExpandedChange(false)
                            viewModel.clearLogs()
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text("离开房间") },
                    onClick = {
                        onMenuExpandedChange(false)
                        viewModel.leaveRoom()
                    },
                )
            }
        }
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
