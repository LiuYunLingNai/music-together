package io.github.yueby.musictogether.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.ArrowUpToLine
import com.composables.icons.lucide.AudioLines
import com.composables.icons.lucide.Download
import com.composables.icons.lucide.EllipsisVertical
import com.composables.icons.lucide.ListMusic
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Play
import com.composables.icons.lucide.RefreshCw
import com.composables.icons.lucide.Trash2
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppTextAction
import io.github.yueby.musictogether.ui.player.DropdownMenu as AppDropdownMenu
import io.github.yueby.musictogether.ui.player.DropdownMenuItem as AppDropdownMenuItem
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun QueuePane(
    room: RoomState,
    viewModel: MusicTogetherViewModel,
    onDownloadCurrent: (() -> Unit)? = null,
) {
    val currentId = room.currentTrack?.id
    val currentIndex = room.queue.indexOfFirst { it.id == currentId }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = (currentIndex - 2).coerceAtLeast(0))
    var autoScrolledTrackId by remember {
        mutableStateOf(currentId?.takeIf { currentIndex >= 0 })
    }
    LaunchedEffect(currentId, currentIndex) {
        if (currentId != autoScrolledTrackId && currentIndex >= 0) {
            listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0))
            autoScrolledTrackId = currentId
        }
    }
    if (room.queue.isEmpty()) {
        AppEmptyState(
            icon = Lucide.ListMusic,
            title = "队列还是空的",
            summary = "去发现页搜索，或从歌单里点歌",
        )
        return
    }
    val canControl = viewModel.canControl()
    // Dragging needs stable unique keys; a queue with repeated ids falls back to a static list.
    val uniqueIds = remember(room.queue) { room.queue.mapTo(HashSet()) { it.id }.size == room.queue.size }
    val canReorder = canControl && uniqueIds
    // The local order follows the finger; the server order replaces it once the reorder is acknowledged.
    var order by remember(room.queue) { mutableStateOf(room.queue) }
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        order = order.toMutableList().apply { add(to.index, removeAt(from.index)) }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize().overScrollVertical(),
        state = listState,
        contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
    ) {
        itemsIndexed(order, key = { index, track -> if (uniqueIds) track.id else "${track.id}:$index" }) { index, track ->
            ReorderableItem(
                state = reorderState,
                key = if (uniqueIds) track.id else "${track.id}:$index",
                enabled = canReorder,
            ) { dragging ->
                val isCurrent = track.id == currentId
                QueueTrackRow(
                    track = track,
                    current = isCurrent,
                    dragging = dragging,
                    canControl = canControl,
                    modifier = if (canReorder) {
                        Modifier.longPressDraggableHandle(
                            onDragStopped = { if (order != room.queue) viewModel.reorderQueue(order) },
                        )
                    } else {
                        Modifier
                    },
                    onPlay = { viewModel.playTrack(track) },
                    onPin = { viewModel.pinTrack(track) },
                    onRemove = { viewModel.removeTrack(track) },
                    onDownload = {
                        if (isCurrent && onDownloadCurrent != null) onDownloadCurrent() else viewModel.downloadTrack(track)
                    },
                    onReselectMetadata = track.takeIf { it.source == "bilibili" }?.let { video ->
                        { viewModel.reselectBilibiliMetadata(video) }
                    },
                )
            }
        }
    }
}

@Composable
private fun QueueTrackRow(
    track: Track,
    current: Boolean,
    dragging: Boolean,
    canControl: Boolean,
    modifier: Modifier,
    onPlay: () -> Unit,
    onPin: () -> Unit,
    onRemove: () -> Unit,
    onDownload: () -> Unit,
    onReselectMetadata: (() -> Unit)?,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val primary = MiuixTheme.colorScheme.primary
    val lift by animateFloatAsState(
        targetValue = if (dragging) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = 400f),
        label = "queue-row-lift",
    )
    val container = when {
        dragging -> MiuixTheme.colorScheme.surfaceContainerHigh
        current -> primary.copy(alpha = 0.12f)
        else -> Color.Transparent
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .graphicsLayer {
                val scale = 1f + 0.02f * lift
                scaleX = scale
                scaleY = scale
            }
            .clip(RoundedCornerShape(16.dp))
            .background(container)
            .clickable(onClick = rememberHapticClick { menuOpen = true })
            .padding(start = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TrackCover(track = track, size = 48.dp, cornerRadius = 9.dp)
        Column(
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body1,
                fontWeight = FontWeight.Medium,
                color = if (current) primary else MiuixTheme.colorScheme.onSurface,
            )
            Text(
                listOfNotNull(
                    track.artist.joinToString(" / ").takeIf { it.isNotBlank() },
                    track.requestedBy?.let { "$it 点歌" },
                ).joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        if (current) Icon(Lucide.AudioLines, "当前播放", Modifier.size(18.dp), tint = primary)
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Lucide.EllipsisVertical, "队列操作", tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
            }
            AppDropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                AppDropdownMenuItem(
                    text = { Text(if (canControl) "播放" else "投票播放") },
                    leadingIcon = { Icon(Lucide.Play, null) },
                    enabled = !current,
                    onClick = { menuOpen = false; onPlay() },
                )
                onReselectMetadata?.let { reselect ->
                    AppDropdownMenuItem(
                        text = { Text("重选歌词和封面") },
                        leadingIcon = { Icon(Lucide.RefreshCw, null) },
                        onClick = { menuOpen = false; reselect() },
                    )
                }
                if (canControl) {
                    AppDropdownMenuItem(
                        text = { Text("置顶到当前播放下方") },
                        leadingIcon = { Icon(Lucide.ArrowUpToLine, null) },
                        enabled = !current,
                        onClick = { menuOpen = false; onPin() },
                    )
                }
                AppDropdownMenuItem(
                    text = { Text("下载") },
                    leadingIcon = { Icon(Lucide.Download, null) },
                    onClick = { menuOpen = false; onDownload() },
                )
                AppDropdownMenuItem(
                    text = { Text(if (canControl) "移除" else "投票移除") },
                    leadingIcon = { Icon(Lucide.Trash2, null) },
                    onClick = { menuOpen = false; onRemove() },
                )
            }
        }
    }
}

@Composable
internal fun QueueClearAction(room: RoomState, viewModel: MusicTogetherViewModel) {
    var confirm by remember { mutableStateOf(false) }
    if (!viewModel.canClearQueue() || room.queue.isEmpty()) return
    AppTextAction(onClick = { confirm = true }) {
        Text("清空", color = MiuixTheme.colorScheme.primary, fontSize = 14.sp)
    }
    if (confirm) {
        AppDialog(
            title = "清空播放队列",
            onDismissRequest = { confirm = false },
            confirmText = "清空",
            onConfirm = {
                confirm = false
                viewModel.clearQueue()
            },
        ) {
            Text("将移除队列中的 ${room.queue.size} 首歌曲，此操作无法撤销。")
        }
    }
}
