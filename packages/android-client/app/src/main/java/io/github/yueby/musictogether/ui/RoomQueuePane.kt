package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.delay

@Composable
internal fun QueuePane(
    room: RoomState,
    viewModel: MusicTogetherViewModel,
    onClose: (() -> Unit)? = null,
) {
    var confirmClear by remember { mutableStateOf(false) }
    val currentIndex = room.queue.indexOfFirst { it.id == room.currentTrack?.id }
    val initialIndex = (currentIndex - 2).coerceAtLeast(0)
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = initialIndex)
    var autoScrolledTrackId by remember {
        mutableStateOf(room.currentTrack?.id?.takeIf { currentIndex >= 0 })
    }
    LaunchedEffect(room.currentTrack?.id, currentIndex) {
        val currentTrackId = room.currentTrack?.id
        if (currentTrackId != autoScrolledTrackId && currentIndex >= 0) {
            listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0))
            autoScrolledTrackId = currentTrackId
        }
    }
    LaunchedEffect(confirmClear) {
        if (confirmClear) {
            delay(3000)
            confirmClear = false
        }
    }
    Column(Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp,
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "播放列表 (${room.queue.size})",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (viewModel.canClearQueue() && room.queue.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            if (confirmClear) {
                                confirmClear = false
                                viewModel.clearQueue()
                            } else {
                                confirmClear = true
                            }
                        },
                    ) {
                        Text(
                            if (confirmClear) "确认清空" else "清空",
                            color =
                                if (confirmClear) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                            fontSize = 12.sp,
                        )
                    }
                }
                onClose?.let { close ->
                    IconButton(onClick = close) {
                        Icon(Icons.Default.Close, contentDescription = "关闭播放列表")
                    }
                }
            }
        }
        HorizontalDivider()
        LazyColumn(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            state = listState,
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
        ) {
            if (room.queue.isEmpty()) {
                item {
                    Text(
                        "队列为空，去点歌页添加歌曲。",
                        Modifier.padding(20.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            itemsIndexed(room.queue, key = { index, track -> "${track.id}:$index" }) { index, track ->
                val isCurrent = track.id == room.currentTrack?.id
                val canReorder = viewModel.canControl()
                TrackRow(
                    track = track,
                    subtitle = buildString {
                        append(track.artist.joinToString(" / "))
                        track.requestedBy?.let { append(" · $it 点歌") }
                        if (isCurrent) append(" · 当前播放")
                    },
                    primaryAction = if (canReorder) null else ({ viewModel.playTrack(track) }),
                    secondaryAction = if (canReorder) null else ({ viewModel.removeTrack(track) }),
                    primaryIcon = Icons.Default.PlayArrow,
                    secondaryIcon = Icons.Default.Delete,
                    extraAction = { viewModel.downloadTrack(track) },
                    extraIcon = Icons.Default.Download,
                    extraContentDescription = "下载歌曲",
                    onClick = { viewModel.playTrack(track) },
                    highlighted = isCurrent,
                    compact = true,
                    trailingContent = if (canReorder || track.source == "bilibili") {
                        {
                            QueueControlMenu(
                                track = track,
                                canMoveUp = index > 0,
                                canMoveDown = index < room.queue.lastIndex,
                                canPin = !isCurrent,
                                onPlay = { viewModel.playTrack(track) },
                                onMoveUp = { viewModel.moveTrack(track, -1) },
                                onMoveDown = { viewModel.moveTrack(track, 1) },
                                onPin = { viewModel.pinTrack(track) },
                                onRemove = { viewModel.removeTrack(track) },
                                onDownload = { viewModel.downloadTrack(track) },
                                onReselectMetadata =
                                    track.takeIf { it.source == "bilibili" }?.let { video ->
                                        { viewModel.reselectBilibiliMetadata(video) }
                                    },
                            )
                        }
                    } else {
                        null
                    },
                )
                HorizontalDivider()
            }
        }
    }
}


@Composable
internal fun TrackRow(
    track: Track,
    subtitle: String,
    primaryAction: (() -> Unit)?,
    primaryIcon: androidx.compose.ui.graphics.vector.ImageVector,
    secondaryAction: (() -> Unit)? = null,
    secondaryIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    extraAction: (() -> Unit)? = null,
    extraIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    extraContentDescription: String? = null,
    onClick: (() -> Unit)? = null,
    highlighted: Boolean = false,
    compact: Boolean = false,
    trailingContent: (@Composable () -> Unit)? = null,
) {
    ListItem(
        modifier = if (onClick != null) Modifier.fillMaxWidth().clickable(onClick = onClick) else Modifier.fillMaxWidth(),
        colors = ListItemDefaults.colors(
            containerColor = if (highlighted) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
        ),
        leadingContent = {
            TrackCover(
                track = track,
                size = if (compact) 40.dp else 48.dp,
                cornerRadius = if (compact) 6.dp else 8.dp,
                contentDescription = null,
            )
        },
        headlineContent = {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 14.sp else 16.sp,
            )
        },
        supportingContent = {
            Text(
                subtitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 12.sp else 14.sp,
            )
        },
        trailingContent = {
            if (trailingContent != null) {
                trailingContent()
            } else {
                Row {
                    if (extraAction != null && extraIcon != null && extraContentDescription != null) {
                        IconButton(onClick = extraAction) { Icon(extraIcon, extraContentDescription) }
                    }
                    primaryAction?.let { IconButton(onClick = it) { Icon(primaryIcon, "播放或投票播放") } }
                    if (secondaryAction != null && secondaryIcon != null) {
                        IconButton(onClick = secondaryAction) { Icon(secondaryIcon, "移除或投票移除") }
                    }
                }
            }
        },
    )
}

@Composable
private fun QueueControlMenu(
    track: Track,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    canPin: Boolean,
    onPlay: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onPin: () -> Unit,
    onRemove: () -> Unit,
    onDownload: () -> Unit,
    onReselectMetadata: (() -> Unit)? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(Icons.Default.MoreVert, "队列操作") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("播放") },
                leadingIcon = { Icon(Icons.Default.PlayArrow, null) },
                onClick = { expanded = false; onPlay() },
            )
            onReselectMetadata?.let { reselect ->
                DropdownMenuItem(
                    text = { Text("重选歌词和封面") },
                    leadingIcon = { Icon(Icons.Default.Refresh, null) },
                    onClick = { expanded = false; reselect() },
                )
            }
            DropdownMenuItem(
                text = { Text("上移") },
                leadingIcon = { Icon(Icons.Default.KeyboardArrowUp, null) },
                enabled = canMoveUp,
                onClick = { expanded = false; onMoveUp() },
            )
            DropdownMenuItem(
                text = { Text("下移") },
                leadingIcon = { Icon(Icons.Default.KeyboardArrowDown, null) },
                enabled = canMoveDown,
                onClick = { expanded = false; onMoveDown() },
            )
            DropdownMenuItem(
                text = { Text("置顶到当前播放下方") },
                leadingIcon = { Icon(Icons.Default.VerticalAlignTop, null) },
                enabled = canPin,
                onClick = { expanded = false; onPin() },
            )
            DropdownMenuItem(
                text = { Text("下载") },
                leadingIcon = { Icon(Icons.Default.Download, null) },
                onClick = { expanded = false; onDownload() },
            )
            DropdownMenuItem(
                text = { Text("移除") },
                leadingIcon = { Icon(Icons.Default.Delete, null) },
                onClick = { expanded = false; onRemove() },
            )
        }
    }
}
