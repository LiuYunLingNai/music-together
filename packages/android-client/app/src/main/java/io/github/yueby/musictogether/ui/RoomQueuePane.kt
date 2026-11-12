package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ArrowUpToLine
import com.composables.icons.lucide.ChevronDown
import com.composables.icons.lucide.ChevronUp
import com.composables.icons.lucide.Download
import com.composables.icons.lucide.EllipsisVertical
import com.composables.icons.lucide.Play
import com.composables.icons.lucide.RefreshCw
import com.composables.icons.lucide.Trash2
import io.github.yueby.musictogether.ui.designsystem.AppTextAction
import io.github.yueby.musictogether.ui.designsystem.AppListItem
import top.yukonga.miuix.kmp.theme.MiuixTheme
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
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.ui.player.DropdownMenu as AppDropdownMenu
import io.github.yueby.musictogether.ui.player.DropdownMenuItem as AppDropdownMenuItem
import kotlinx.coroutines.delay

@Composable
internal fun QueuePane(
    room: RoomState,
    viewModel: MusicTogetherViewModel,
    onClose: (() -> Unit)? = null,
    onDownloadCurrent: (() -> Unit)? = null,
) {
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
    Column(Modifier.fillMaxSize()) {
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
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
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
                    primaryIcon = Lucide.Play,
                    secondaryIcon = Lucide.Trash2,
                    extraAction = {
                        if (isCurrent && onDownloadCurrent != null) onDownloadCurrent() else viewModel.downloadTrack(track)
                    },
                    extraIcon = Lucide.Download,
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
                                onDownload = {
                                    if (isCurrent && onDownloadCurrent != null) onDownloadCurrent() else viewModel.downloadTrack(track)
                                },
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
    headlineMaxLines: Int = 1,
    supportingMaxLines: Int = 1,
    trailingContent: (@Composable () -> Unit)? = null,
) {
    AppListItem(
        modifier = if (onClick != null) Modifier.fillMaxWidth().clickable(onClick = onClick) else Modifier.fillMaxWidth(),
        containerColor = if (highlighted) MiuixTheme.colorScheme.primaryContainer else Color.Transparent,
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
                maxLines = headlineMaxLines,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 14.sp else 16.sp,
            )
        },
        supportingContent = {
            Text(
                subtitle,
                maxLines = supportingMaxLines,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 12.sp else 14.sp,
                style = MiuixTheme.textStyles.body2,
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
        IconButton(onClick = { expanded = true }) { Icon(Lucide.EllipsisVertical, "队列操作") }
        AppDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            AppDropdownMenuItem(
                text = { Text("播放") },
                leadingIcon = { Icon(Lucide.Play, null) },
                onClick = { expanded = false; onPlay() },
            )
            onReselectMetadata?.let { reselect ->
                AppDropdownMenuItem(
                    text = { Text("重选歌词和封面") },
                    leadingIcon = { Icon(Lucide.RefreshCw, null) },
                    onClick = { expanded = false; reselect() },
                )
            }
            AppDropdownMenuItem(
                text = { Text("上移") },
                leadingIcon = { Icon(Lucide.ChevronUp, null) },
                enabled = canMoveUp,
                onClick = { expanded = false; onMoveUp() },
            )
            AppDropdownMenuItem(
                text = { Text("下移") },
                leadingIcon = { Icon(Lucide.ChevronDown, null) },
                enabled = canMoveDown,
                onClick = { expanded = false; onMoveDown() },
            )
            AppDropdownMenuItem(
                text = { Text("置顶到当前播放下方") },
                leadingIcon = { Icon(Lucide.ArrowUpToLine, null) },
                enabled = canPin,
                onClick = { expanded = false; onPin() },
            )
            AppDropdownMenuItem(
                text = { Text("下载") },
                leadingIcon = { Icon(Lucide.Download, null) },
                onClick = { expanded = false; onDownload() },
            )
            AppDropdownMenuItem(
                text = { Text("移除") },
                leadingIcon = { Icon(Lucide.Trash2, null) },
                onClick = { expanded = false; onRemove() },
            )
        }
    }
}

@Composable
internal fun QueueClearAction(room: RoomState, viewModel: MusicTogetherViewModel) {
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(confirm) {
        if (confirm) {
            delay(3000)
            confirm = false
        }
    }
    if (!viewModel.canClearQueue() || room.queue.isEmpty()) return
    AppTextAction(onClick = { if (confirm) { confirm = false; viewModel.clearQueue() } else confirm = true }) {
        Text(
            if (confirm) "确认清空" else "清空",
            color = if (confirm) MiuixTheme.colorScheme.error else MiuixTheme.colorScheme.primary,
            fontSize = 14.sp,
        )
    }
}
