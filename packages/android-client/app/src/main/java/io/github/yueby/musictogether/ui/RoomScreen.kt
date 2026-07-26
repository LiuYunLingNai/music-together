package io.github.yueby.musictogether.ui

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private enum class RoomTab(val label: String) {
    Player("播放"), Queue("队列"), Search("点歌"), Chat("聊天")
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
                    IconButton(onClick = viewModel::leaveRoom) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "离开房间")
                    }
                },
                actions = {
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
                RoomTab.Player -> PlayerPane(room, appState.userId, playerState, viewModel)
                RoomTab.Queue -> QueuePane(room, viewModel)
                RoomTab.Search -> SearchPane(appState, viewModel)
                RoomTab.Chat -> ChatPane(appState.messages, viewModel)
            }
            appState.activeVote?.let { vote ->
                Card(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${vote.initiatorNickname} 发起了“${voteActionLabel(vote.action)}”投票", fontWeight = FontWeight.SemiBold)
                        Text("需要 ${vote.requiredVotes} 票 · 共 ${vote.totalUsers} 人", style = MaterialTheme.typography.bodySmall)
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

@Composable
private fun PlayerPane(room: RoomState, userId: String?, player: PlayerUiState, viewModel: MusicTogetherViewModel) {
    val track = player.track ?: room.currentTrack
    var dragging by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableDoubleStateOf(player.positionSeconds) }
    LaunchedEffect(player.positionSeconds) { if (!dragging) sliderValue = player.positionSeconds }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            if (track != null) {
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
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp)) {
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
        items(room.queue, key = { it.id }) { track ->
            TrackRow(
                track = track,
                subtitle = track.requestedBy?.let { "${track.artist.joinToString(" / ")} · $it 点歌" } ?: track.artist.joinToString(" / "),
                primaryAction = if (viewModel.canControl()) ({ viewModel.playTrack(track) }) else null,
                secondaryAction = if (viewModel.canControl()) ({ viewModel.removeTrack(track) }) else null,
                primaryIcon = Icons.Default.PlayArrow,
                secondaryIcon = Icons.Default.Delete,
            )
            HorizontalDivider()
        }
    }
}

@Composable
private fun SearchPane(state: AppState, viewModel: MusicTogetherViewModel) {
    var keyword by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("netease") }
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
        } else {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 8.dp)) {
                items(state.searchResults, key = { it.id }) { track ->
                    TrackRow(
                        track = track,
                        subtitle = "${track.artist.joinToString(" / ")} · ${track.album}",
                        primaryAction = { viewModel.addTrack(track) },
                        primaryIcon = Icons.AutoMirrored.Filled.PlaylistAdd,
                    )
                    HorizontalDivider()
                }
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
) {
    ListItem(
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
            Row {
                primaryAction?.let { IconButton(onClick = it) { Icon(primaryIcon, null) } }
                if (secondaryAction != null && secondaryIcon != null) {
                    IconButton(onClick = secondaryAction) { Icon(secondaryIcon, null) }
                }
            }
        },
    )
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
