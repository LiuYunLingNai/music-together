package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.delay

@Composable
internal fun MembersPane(room: RoomState, userId: String?) {
    val roleOrder = mapOf("owner" to 0, "admin" to 1, "member" to 2)
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Groups, contentDescription = null, Modifier.size(20.dp))
            Text(
                "在线成员 (${room.users.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(
                room.users.sortedBy { roleOrder[it.role] ?: 9 },
                key = { it.id },
            ) { user ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.AccountCircle,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                        tint = if (user.id == room.creatorId) {
                            Color(0xFFFFC857)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        user.nickname,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 14.sp,
                    )
                    if (user.id == userId) {
                        Text(
                            "你",
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.secondaryContainer)
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            fontSize = 11.sp,
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        roleLabel(user.role),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@Composable
internal fun QueuePane(
    room: RoomState,
    viewModel: MusicTogetherViewModel,
    onClose: (() -> Unit)? = null,
) {
    val listState = rememberLazyListState()
    var confirmClear by remember { mutableStateOf(false) }
    val currentIndex = room.queue.indexOfFirst { it.id == room.currentTrack?.id }
    LaunchedEffect(room.currentTrack?.id, room.queue.size) {
        if (currentIndex >= 0) listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0) + 1)
    }
    LaunchedEffect(confirmClear) {
        if (confirmClear) {
            delay(3000)
            confirmClear = false
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        state = listState,
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
    ) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "播放列表 (${room.queue.size})",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (viewModel.canControl() && room.queue.isNotEmpty()) {
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
                            color = if (confirmClear) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
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
        if (room.queue.isEmpty()) {
            item { Text("队列为空，去点歌页添加歌曲。", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
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
                onClick = { viewModel.playTrack(track) },
                highlighted = isCurrent,
                compact = true,
                trailingContent = if (canReorder) {
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
                        )
                    }
                } else null,
            )
            HorizontalDivider()
        }
    }
}

@Composable
internal fun SearchPane(state: AppState, viewModel: MusicTogetherViewModel) {
    var keyword by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("netease") }
    val listState = rememberLazyListState()
    val shouldLoadMore by remember(
        listState,
        state.searchResults.size,
        state.searchHasMore,
        state.searchLoadingMore,
    ) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.searchHasMore && !state.searchLoadingMore &&
                state.searchResults.isNotEmpty() && lastVisible >= state.searchResults.lastIndex - 3
        }
    }
    LaunchedEffect(shouldLoadMore, state.searchResults.size) {
        if (shouldLoadMore) viewModel.loadMoreSearch()
    }
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("搜索并点歌", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(8.dp))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("netease" to "网易云", "tencent" to "QQ 音乐", "kugou" to "酷狗").forEach { (value, label) ->
                AssistChip(onClick = { source = value }, label = { Text(label) }, leadingIcon = if (source == value) {
                    { Icon(Icons.Default.MusicNote, null, Modifier.size(16.dp)) }
                } else null)
            }
        }
        OutlinedTextField(
            value = keyword,
            onValueChange = { keyword = it.take(100) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("歌曲、歌手或专辑") },
            singleLine = true,
            trailingIcon = {
                IconButton(onClick = { viewModel.search(keyword, source) }) { Icon(Icons.Default.Search, "搜索") }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { viewModel.search(keyword, source) }),
        )
        if (state.searchLoading) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (state.searchError != null && state.searchResults.isEmpty()) {
            Text(
                "搜索失败：${state.searchError}",
                modifier = Modifier.padding(20.dp),
                color = MaterialTheme.colorScheme.error,
            )
        } else if (state.searchHasSearched && state.searchResults.isEmpty()) {
            Text("未找到结果，请尝试其他关键词或音乐源。", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(
                Modifier.weight(1f),
                state = listState,
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                items(state.searchResults, key = { it.id }) { track ->
                    val isAdded = state.room?.queue?.any { it.id == track.id } == true
                    TrackRow(
                        track = track,
                        subtitle = "${track.artist.joinToString(" / ")} · ${track.album}",
                        primaryAction = null,
                        primaryIcon = Icons.AutoMirrored.Filled.PlaylistAdd,
                        onClick = if (isAdded) null else ({ viewModel.addTrack(track) }),
                        trailingContent = {
                            SearchTrackActions(
                                isAdded = isAdded,
                                onAdd = { viewModel.addTrack(track) },
                                onPin = { viewModel.insertAfterCurrent(track) },
                            )
                        },
                    )
                    HorizontalDivider()
                }
                if (state.searchLoadingMore) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                } else if (state.searchError != null) {
                    item {
                        Text(
                            "加载下一页失败：${state.searchError}",
                            modifier = Modifier.padding(20.dp),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                } else if (!state.searchHasMore && state.searchResults.isNotEmpty()) {
                    item {
                        Text(
                            "已经到底了",
                            modifier = Modifier.fillMaxWidth().padding(20.dp),
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchTrackActions(isAdded: Boolean, onAdd: () -> Unit, onPin: () -> Unit) {
    Row {
        IconButton(onClick = onAdd, enabled = !isAdded) {
            Icon(
                if (isAdded) Icons.Default.Check else Icons.AutoMirrored.Filled.PlaylistAdd,
                if (isAdded) "已添加" else "添加到播放列表",
                tint = if (isAdded) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
        }
        if (!isAdded) {
            IconButton(onClick = onPin) {
                Icon(Icons.Default.VerticalAlignTop, "置顶到当前播放下方")
            }
        }
    }
}

@Composable
internal fun ChatPane(
    messages: List<ChatMessage>,
    viewModel: MusicTogetherViewModel,
    onClose: (() -> Unit)? = null,
) {
    var content by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "聊天",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            onClose?.let { close ->
                IconButton(onClick = close) {
                    Icon(Icons.Default.Close, contentDescription = "关闭聊天")
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        LazyColumn(
            modifier = Modifier.weight(1f),
            state = listState,
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(messages, key = { it.id }) { message ->
                if (message.type == "system") {
                    Text(
                        message.content,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.55f))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                    ) {
                        Text("${message.nickname} · ${formatMessageTime(message.timestamp)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(message.content)
                    }
                }
            }
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = content,
                onValueChange = { content = it.take(500) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("说点什么…") },
                maxLines = 3,
                trailingIcon = {
                    IconButton(onClick = { viewModel.sendChat(content); content = "" }, enabled = content.isNotBlank()) {
                        Icon(Icons.AutoMirrored.Filled.Send, "发送")
                    }
                },
            )
        }
    }
}

@Composable
private fun TrackRow(
    track: Track,
    subtitle: String,
    primaryAction: (() -> Unit)?,
    primaryIcon: androidx.compose.ui.graphics.vector.ImageVector,
    secondaryAction: (() -> Unit)? = null,
    secondaryIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
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
            AsyncImage(
                model = track.cover,
                contentDescription = null,
                modifier = Modifier
                    .size(if (compact) 40.dp else 48.dp)
                    .clip(RoundedCornerShape(if (compact) 6.dp else 8.dp)),
                contentScale = ContentScale.Crop,
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
                text = { Text("移除") },
                leadingIcon = { Icon(Icons.Default.Delete, null) },
                onClick = { expanded = false; onRemove() },
            )
        }
    }
}
