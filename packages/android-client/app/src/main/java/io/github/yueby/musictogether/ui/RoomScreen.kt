package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private enum class RoomTab(val label: String) {
    Player("播放"), Queue("队列"), Search("点歌"), Account("账号"), Chat("聊天")
}

private enum class PlayerVisual(val label: String) {
    Cover("封面"), Lyrics("歌词")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    appState: AppState,
    playerState: PlayerUiState,
    outerPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
) {
    val room = appState.room ?: return
    var selectedTab by remember { mutableStateOf(RoomTab.Player) }
    val context = LocalContext.current
    val navigateBack = {
        if (selectedTab == RoomTab.Player) viewModel.leaveRoom() else selectedTab = RoomTab.Player
    }

    BackHandler(onBack = navigateBack)
    LaunchedEffect(selectedTab) {
        viewModel.setChatVisible(selectedTab == RoomTab.Chat)
    }
    DisposableEffect(Unit) {
        onDispose { viewModel.setChatVisible(false) }
    }

    Scaffold(
        modifier = Modifier.padding(outerPadding),
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(room.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("房间号 ${room.id} · ${room.users.size} 人", style = MaterialTheme.typography.labelSmall)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = navigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            if (selectedTab == RoomTab.Player) "离开房间" else "返回播放界面",
                        )
                    }
                },
                actions = {
                    if (BuildConfig.DEBUG) {
                        IconButton(onClick = { AppLogger.export(context) }) {
                            Icon(Icons.Default.FileUpload, "导出日志")
                        }
                        IconButton(onClick = viewModel::clearLogs) {
                            Icon(Icons.Default.DeleteSweep, "清空日志")
                        }
                    }
                    if (room.hasPassword) Icon(Icons.Default.Lock, "密码房间", Modifier.padding(12.dp))
                },
            )
        },
        bottomBar = {
            NavigationBar {
                RoomTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = {
                            Icon(
                                when (tab) {
                                    RoomTab.Player -> Icons.Default.MusicNote
                                    RoomTab.Queue -> Icons.AutoMirrored.Filled.QueueMusic
                                    RoomTab.Search -> Icons.Default.Search
                                    RoomTab.Account -> Icons.Default.AccountCircle
                                    RoomTab.Chat -> Icons.AutoMirrored.Filled.Chat
                                },
                                null,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (selectedTab) {
                RoomTab.Player -> PlayerPane(room, appState.userId, appState.lyrics, playerState, viewModel)
                RoomTab.Queue -> QueuePane(room, viewModel)
                RoomTab.Search -> SearchPane(appState, viewModel)
                RoomTab.Account -> PlatformPane(appState, viewModel)
                RoomTab.Chat -> ChatPane(appState.messages, viewModel)
            }
            appState.activeVote?.let { vote ->
                val hasVoted = appState.userId?.let(vote.votes::containsKey) == true
                val approveCount = vote.votes.values.count { it }
                val rejectCount = vote.votes.values.count { !it }
                Card(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${vote.initiatorNickname} 发起了“${voteActionLabel(vote.action)}”投票", fontWeight = FontWeight.SemiBold)
                        vote.payload["trackTitle"]?.takeIf { it.isNotBlank() }?.let {
                            Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text("赞成 $approveCount · 反对 $rejectCount · 需要 ${vote.requiredVotes} 票", style = MaterialTheme.typography.bodySmall)
                        if (hasVoted) {
                            Text(
                                if (vote.initiatorId == appState.userId) "你发起了投票，已自动计入赞成票" else "你已投票",
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold,
                            )
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { viewModel.castVote(true) }) { Text("同意") }
                                OutlinedButton(onClick = { viewModel.castVote(false) }) { Text("反对") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerPane(
    room: RoomState,
    userId: String?,
    lyrics: LyricsState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
) {
    val track = player.track ?: room.currentTrack
    var dragging by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableDoubleStateOf(player.positionSeconds) }
    var visual by remember { mutableStateOf(PlayerVisual.Cover) }
    LaunchedEffect(player.positionSeconds) { if (!dragging) sliderValue = player.positionSeconds }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                PlayerVisual.entries.forEach { option ->
                    AssistChip(
                        onClick = { visual = option },
                        label = { Text(option.label) },
                        leadingIcon = if (visual == option) {
                            { Icon(if (option == PlayerVisual.Cover) Icons.Default.LibraryMusic else Icons.Default.MusicNote, null, Modifier.size(16.dp)) }
                        } else null,
                    )
                    Spacer(Modifier.size(6.dp))
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 320.dp, max = 460.dp)) {
                if (visual == PlayerVisual.Lyrics && track != null) {
                    LyricsPanel(lyrics, player.positionSeconds, player.playing)
                } else if (track != null) {
                    AsyncImage(
                        model = track.cover,
                        contentDescription = track.title,
                        modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(24.dp)),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Card(Modifier.fillMaxWidth().aspectRatio(1f)) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.LibraryMusic, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
        item {
            Text(track?.title ?: "队列还是空的", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(track?.artist?.joinToString(" / ") ?: "前往“点歌”搜索音乐", color = MaterialTheme.colorScheme.onSurfaceVariant)
            player.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        item {
            val duration = (track?.duration ?: 0.0).coerceAtLeast(1.0)
            Slider(
                value = sliderValue.coerceIn(0.0, duration).toFloat(),
                onValueChange = { dragging = true; sliderValue = it.toDouble() },
                onValueChangeFinished = { dragging = false; viewModel.seek(sliderValue) },
                valueRange = 0f..duration.toFloat(),
                enabled = track != null && viewModel.canControl(),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatTime(sliderValue), style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.weight(1f))
                Text(formatTime(track?.duration ?: 0.0), style = MaterialTheme.typography.labelMedium)
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = viewModel::previous, enabled = track != null) {
                    Icon(Icons.Default.FastRewind, "上一首", Modifier.size(36.dp))
                }
                FilledIconButton(onClick = viewModel::togglePlayback, enabled = track != null, modifier = Modifier.size(64.dp)) {
                    Icon(if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow, "播放/暂停", Modifier.size(36.dp))
                }
                IconButton(onClick = viewModel::next, enabled = track != null) {
                    Icon(Icons.Default.FastForward, "下一首", Modifier.size(36.dp))
                }
            }
        }
        item {
            Text("播放模式", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("sequential" to "顺序", "loop-all" to "列表循环", "loop-one" to "单曲", "shuffle" to "随机").forEach { (mode, label) ->
                    AssistChip(onClick = { viewModel.setPlayMode(mode) }, label = { Text(label) }, leadingIcon = if (room.playMode == mode) {
                        { Icon(Icons.Default.PlayArrow, null, Modifier.size(16.dp)) }
                    } else null)
                }
            }
        }
        item {
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Groups, null)
                Text("房间成员", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
        }
        items(room.users, key = { it.id }) { user ->
            ListItem(
                headlineContent = { Text(user.nickname + if (user.id == userId) "（我）" else "") },
                supportingContent = { Text(roleLabel(user.role)) },
                trailingContent = { if (user.id == room.hostId) Text("当前主持") },
            )
        }
    }
}

@Composable
private fun QueuePane(room: RoomState, viewModel: MusicTogetherViewModel) {
    val listState = rememberLazyListState()
    val currentIndex = room.queue.indexOfFirst { it.id == room.currentTrack?.id }
    LaunchedEffect(room.currentTrack?.id, room.queue.size) {
        if (currentIndex >= 0) listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0) + 1)
    }
    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(12.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("播放队列", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("${room.queue.size} 首歌曲", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (viewModel.canControl() && room.queue.isNotEmpty()) {
                    TextButton(onClick = viewModel::clearQueue) { Text("清空") }
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
private fun SearchPane(state: AppState, viewModel: MusicTogetherViewModel) {
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
private fun ChatPane(messages: List<ChatMessage>, viewModel: MusicTogetherViewModel) {
    var content by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.weight(1f),
            state = listState,
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(messages, key = { it.id }) { message ->
                if (message.type == "system") {
                    Text(message.content, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Column {
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
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(8.dp)),
                contentScale = ContentScale.Crop,
            )
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis) },
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

@Composable
private fun LyricsPanel(lyrics: LyricsState, positionSeconds: Double, isPlaying: Boolean) {
    val rawPositionMs = (positionSeconds * 1000.0).toFloat().coerceAtLeast(0f)
    val positionMs = rememberSmoothPositionMs(rawPositionMs, isPlaying)
    val lines = lyrics.lines
    val positionLong = positionMs.toLong()
    val activeIndex = lines.indexOfLast {
        !it.isBackground && positionLong >= it.startTimeMs && positionLong < it.endTimeMs
    }.takeIf { it >= 0 } ?: lines.indexOfLast { !it.isBackground && positionLong >= it.startTimeMs }
    val listState = rememberLazyListState()
    // 网页端 AMLL 默认 alignPosition=0.4：当前行锚定在视口 ~40% 位置（靠上一些，不是正中）
    LaunchedEffect(activeIndex, lines.size) {
        if (activeIndex >= 0) listState.animateScrollToItem((activeIndex - 2).coerceAtLeast(0))
    }

    when {
        lyrics.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        lines.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(lyrics.error ?: "暂无歌词", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = listState,
            // 透明背景，让歌词直接浮在播放器背景上（对齐网页端 amll-container）
            contentPadding = PaddingValues(horizontal = 32.dp, vertical = 140.dp),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            itemsIndexed(lines, key = { index, line -> "${line.startTimeMs}:$index" }) { index, line ->
                val overlapsPlayback = positionLong >= line.startTimeMs && positionLong < line.endTimeMs
                LyricLineItem(line, positionMs, index == activeIndex || overlapsPlayback)
            }
        }
    }
}

@Composable
private fun LyricLineItem(line: LyricLine, positionMs: Float, active: Boolean) {
    if (line.isInterlude) {
        InterludeDots(line, positionMs, active)
        return
    }
    val alignment = if (line.isDuet) Alignment.End else Alignment.Start
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val isBackground = line.isBackground

    // 对齐网页端 AMLL：字号、字重统一，靠 scale/alpha 区分 active 与非 active
    val scale by animateFloatAsState(
        targetValue = if (active) 1f else 0.92f,
        animationSpec = spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow),
        label = "lyricScale",
    )
    val alpha by animateFloatAsState(
        targetValue = if (active) 1f else if (isBackground) 0.3f else 0.5f,
        animationSpec = tween(500),
        label = "lyricAlpha",
    )
    // 网页端 fontWeight=600 (SemiBold)，不区分 active
    val fontWeight = FontWeight.SemiBold
    // 字号不变化（对齐网页端 enableScale 但字号本身统一）
    val fontSize = if (isBackground) 16f else 22f

    val playedColor = MaterialTheme.colorScheme.onSurface
    val unplayedColor = remember(playedColor) { playedColor.copy(alpha = 0.4f) }

    // 整行上浮：Animatable + spring 弹性跟随
    val lineProgress = if (line.endTimeMs > line.startTimeMs) {
        ((positionMs - line.startTimeMs) / (line.endTimeMs - line.startTimeMs)).coerceIn(0f, 1f)
    } else 0f
    val rowOffsetAnim = remember { Animatable(0f) }
    LaunchedEffect(lineProgress) {
        rowOffsetAnim.animateTo(
            targetValue = (1f - lineProgress) * 10f,
            animationSpec = spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessLow),
        )
    }
    val rowOffset = rowOffsetAnim.value

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                this.alpha = alpha
                translationY = if (active) -rowOffset else rowOffset * 0.35f
                transformOrigin = if (line.isDuet) TransformOrigin(1f, 0f) else TransformOrigin(0f, 0f)
            },
        horizontalAlignment = alignment,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = buildLyricText(
                words = line.words,
                positionMs = positionMs,
                playedColor = playedColor,
                unplayedColor = unplayedColor,
                fontWeight = fontWeight,
            ),
            modifier = Modifier.fillMaxWidth(),
            textAlign = textAlign,
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.4f).sp,
            fontWeight = fontWeight,
        )
        // 翻译/罗马音字号 = 主歌词的 75%（对齐网页端 translationFontSize=75）
        line.translatedLyric.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                Modifier
                    .fillMaxWidth()
                    .graphicsLayer { translationY = if (active) -rowOffset * 0.35f else 0f },
                textAlign = textAlign,
                fontSize = (fontSize * 0.75f).sp,
                lineHeight = ((fontSize * 0.75f) * 1.3f).sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Normal,
            )
        }
        line.romanLyric.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                Modifier
                    .fillMaxWidth()
                    .graphicsLayer { translationY = if (active) -rowOffset * 0.25f else 0f },
                textAlign = textAlign,
                fontSize = (fontSize * 0.75f).sp,
                lineHeight = ((fontSize * 0.75f) * 1.3f).sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Normal,
            )
        }
    }
}

/**
 * 构建歌词 AnnotatedString。
 * 逐字颜色用 [lerp] 做 0..1 平滑过渡（对齐网页端 AMLL 的逐字扫光）。
 */
private fun buildLyricText(
    words: List<LyricWord>,
    positionMs: Float,
    playedColor: Color,
    unplayedColor: Color,
    fontWeight: FontWeight,
) = buildAnnotatedString {
    words.forEach { word ->
        val ratio = wordProgress(word, positionMs)
        val color = when {
            ratio <= 0f -> unplayedColor
            ratio >= 1f -> playedColor
            else -> lerp(unplayedColor, playedColor, ratio)
        }
        withStyle(SpanStyle(color = color, fontWeight = fontWeight)) { append(word.text) }
    }
}

@Composable
private fun InterludeDots(line: LyricLine, positionMs: Float, active: Boolean) {
    val start = line.startTimeMs.toFloat()
    val end = line.endTimeMs.toFloat()
    val duration = (end - start).coerceAtLeast(1f)
    val progress = ((positionMs - start) / duration).coerceIn(0f, 0.999f)
    val highlightedDot = (progress * 3).toInt().coerceIn(0, 2)
    val alpha by animateFloatAsState(
        targetValue = if (active) 1f else 0.42f,
        animationSpec = tween(500),
        label = "interludeAlpha",
    )
    val lineProgress = (progress / 0.999f).coerceIn(0f, 1f)
    val rowOffsetAnim = remember { Animatable(0f) }
    LaunchedEffect(lineProgress) {
        rowOffsetAnim.animateTo(
            targetValue = lineProgress * 10f,
            animationSpec = spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessLow),
        )
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(31.dp)
            .graphicsLayer {
                this.alpha = alpha
                translationY = if (active) -rowOffsetAnim.value else 0f
            },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { index ->
            val highlighted = active && index == highlightedDot
            val size by animateFloatAsState(
                targetValue = if (highlighted) 10f else 7f,
                animationSpec = spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow),
                label = "dot$index",
            )
            val dotAlpha by animateFloatAsState(
                targetValue = if (highlighted) 1f else 0.55f,
                animationSpec = tween(220),
                label = "dotAlpha$index",
            )
            Box(
                Modifier
                    .size(size.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = dotAlpha)),
            )
        }
    }
}

/**
 * 把 NativePlayer 每 250ms 推送一次的 [rawPositionMs] 在 Compose 帧内插值为连续值。
 * 关键：用 [withFrameNanos] 按 60fps 推进内部 tick，让逐字扫光与行上浮在外部采样之间也是连续的。
 *
 * - 当 [rawPositionMs] 与内部位置差 > 2s（seek / 切歌）直接 snap；
 * - 暂停时停止 tick，position 锁定在最后一次 rawPositionMs；
 * - 播放时每帧叠加 (now - last) ms，外部更新时再 snap 修正漂移。
 */
@Composable
private fun rememberSmoothPositionMs(rawPositionMs: Float, isPlaying: Boolean): Float {
    val position = remember { mutableFloatStateOf(rawPositionMs) }

    // 外部采样到来：先记录基准，再让 tick 在两帧之间追赶，避免漂移
    LaunchedEffect(rawPositionMs) {
        val delta = kotlin.math.abs(rawPositionMs - position.floatValue)
        if (delta > 2_000f) {
            position.floatValue = rawPositionMs
        } else if (!isPlaying) {
            // 暂停时直接把内部位置对齐到 raw，避免切到播放时跳一大截
            position.floatValue = rawPositionMs
        }
    }

    LaunchedEffect(isPlaying) {
        if (!isPlaying) return@LaunchedEffect
        var lastNanos = 0L
        while (true) {
            withFrameNanos { nanos ->
                if (lastNanos == 0L) {
                    lastNanos = nanos
                    return@withFrameNanos
                }
                val dtMs = (nanos - lastNanos) / 1_000_000f
                lastNanos = nanos
                // 正常推进：内部位置按帧间隔累加
                position.floatValue = position.floatValue + dtMs
            }
        }
    }
    return position.floatValue
}

/** 计算某个字在当前播放位置下的填充比例，0=未播放，1=已播放完。 */
private fun wordProgress(word: LyricWord, positionMs: Float): Float {
    val start = word.startTimeMs.toFloat()
    val end = word.endTimeMs.toFloat()
    if (positionMs <= start) return 0f
    if (positionMs >= end) return 1f
    val span = (end - start).coerceAtLeast(1f)
    return ((positionMs - start) / span).coerceIn(0f, 1f)
}

private fun formatTime(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0) return "--:--"
    val total = seconds.roundToInt()
    return "%d:%02d".format(total / 60, total % 60)
}

private fun formatMessageTime(timestamp: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))

private fun roleLabel(role: String): String = when (role) {
    "owner" -> "房主"
    "admin" -> "管理员"
    else -> "成员"
}

private fun voteActionLabel(action: String): String = when (action) {
    "pause" -> "暂停"
    "resume" -> "继续播放"
    "next" -> "下一首"
    "prev" -> "上一首"
    "set-mode" -> "切换播放模式"
    "play-track" -> "播放歌曲"
    "remove-track" -> "移除歌曲"
    else -> action
}
