package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState
@Composable
internal fun LandscapePlayerContent(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    activeVote: VoteState?,
    userId: String?,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
    chromeVisible: Boolean,
    metrics: PlayerLayoutMetrics,
) {
    var artworkHorizontalInset by remember { mutableStateOf(0.dp) }
    val transportScale = metrics.controlsScale.coerceIn(0.78f, 1f)
    val railInternalStartPadding = (8f * transportScale).dp
    val railStartPadding =
        (artworkHorizontalInset - railInternalStartPadding).coerceAtLeast(0.dp)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(
                horizontal = metrics.horizontalPadding,
                vertical = metrics.verticalPadding,
            ),
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            LandscapeCoverArtwork(
                track = track,
                modifier = Modifier
                    .weight(0.40f)
                    .fillMaxHeight(),
                onHorizontalInsetChanged = { artworkHorizontalInset = it },
            )
            Spacer(Modifier.width(metrics.columnGap))
            Column(
                modifier = Modifier
                    .weight(0.60f)
                    .fillMaxHeight(),
            ) {
                LandscapeSongHeader(
                    track = track,
                    error = player.error,
                    onOpenChat = onOpenChat,
                    chromeVisible = chromeVisible,
                    layoutScale = metrics.controlsScale,
                )
                Spacer(Modifier.height(metrics.compactGap))
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                ) {
                    LyricsPanel(
                        lyrics = lyrics,
                        positionSeconds = player.positionSeconds,
                        lyricOffsetMs = lyricOffsetMs,
                        isPlaying = player.playing,
                        onSeek = { lyricTimeSeconds ->
                            viewModel.seek(lyricTimeSeconds + lyricOffsetMs / 1_000.0)
                        },
                    )
                    activeVote?.let { vote ->
                        LandscapeVotePrompt(
                            vote = vote,
                            userId = userId,
                            onCastVote = viewModel::castVote,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = 18.dp, vertical = 4.dp),
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(metrics.compactGap))
        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.CenterEnd,
        ) {
            LandscapeTransportRail(
                track = track,
                room = room,
                player = player,
                viewModel = viewModel,
                onOpenQueue = onOpenQueue,
                layoutScale = metrics.controlsScale,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = railStartPadding, end = 12.dp),
            )
        }
    }
}

@Composable
private fun LandscapeCoverArtwork(
    track: Track?,
    modifier: Modifier = Modifier,
    onHorizontalInsetChanged: (Dp) -> Unit = {},
) {
    BoxWithConstraints(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        val artworkSize = minOf(maxWidth, maxHeight).coerceAtMost(430.dp)
        val horizontalInset = ((maxWidth - artworkSize) / 2f).coerceAtLeast(0.dp)
        LaunchedEffect(horizontalInset) {
            onHorizontalInsetChanged(horizontalInset)
        }
        if (track != null && track.cover.isNotBlank()) {
            AsyncImage(
                model = track.cover,
                contentDescription = track.title,
                modifier = Modifier
                    .size(artworkSize)
                    .graphicsLayer {
                        shadowElevation = 18.dp.toPx()
                        shape = RoundedCornerShape(24.dp)
                        clip = true
                    },
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                modifier = Modifier
                    .size(artworkSize)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.White.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.LibraryMusic,
                    contentDescription = null,
                    modifier = Modifier.size((artworkSize * 0.28f).coerceAtLeast(40.dp)),
                    tint = Color.White.copy(alpha = 0.72f),
                )
            }
        }
    }
}

@Composable
private fun LandscapeSongHeader(
    track: Track?,
    error: String?,
    onOpenChat: () -> Unit,
    chromeVisible: Boolean,
    layoutScale: Float,
) {
    val scale = layoutScale.coerceIn(0.78f, 1f)
    val chatAlpha by animateFloatAsState(
        targetValue = if (chromeVisible) 0f else 1f,
        animationSpec = tween(180),
        label = "landscape-chat-chrome-avoidance",
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 18.dp, end = 20.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy((10f * scale).dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = track?.title ?: "暂无歌曲",
                modifier = Modifier.basicMarquee(),
                color = Color.White.copy(alpha = 0.94f),
                fontSize = (23f * scale).sp,
                lineHeight = (27f * scale).sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
            Text(
                text = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                modifier = Modifier.basicMarquee(),
                color =
                    if (error == null) Color.White.copy(alpha = 0.52f) else Color(0xFFFF8A80),
                fontSize = (13f * scale).sp,
                lineHeight = (17f * scale).sp,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
        }
        IconButton(
            onClick = onOpenChat,
            enabled = !chromeVisible,
            modifier = Modifier.size((42f * scale).dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = "打开聊天",
                modifier = Modifier
                    .size((22f * scale).dp)
                    .graphicsLayer { alpha = chatAlpha },
                tint = Color.White.copy(alpha = 0.72f),
            )
        }
    }
}

@Composable
private fun LandscapeVotePrompt(
    vote: VoteState,
    userId: String?,
    onCastVote: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasVoted = userId?.let(vote.votes::containsKey) == true
    val approveCount = vote.votes.values.count { it }
    val rejectCount = vote.votes.values.count { !it }

    Surface(
        modifier = modifier.widthIn(max = 390.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color.Black.copy(alpha = 0.72f),
        tonalElevation = 0.dp,
        shadowElevation = 12.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "${vote.initiatorNickname} 发起“${playerVoteActionLabel(vote.action)}”投票",
                    color = Color.White.copy(alpha = 0.92f),
                    fontSize = 13.sp,
                    lineHeight = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = buildString {
                        vote.payload["trackTitle"]?.takeIf { it.isNotBlank() }?.let {
                            append(it)
                            append(" · ")
                        }
                        append("赞成 $approveCount · 反对 $rejectCount · 需要 ${vote.requiredVotes} 票")
                    },
                    color = Color.White.copy(alpha = 0.54f),
                    fontSize = 10.sp,
                    lineHeight = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (hasVoted) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = Color.White.copy(alpha = 0.76f),
                    )
                    Text(
                        if (vote.initiatorId == userId) "已发起" else "已投票",
                        color = Color.White.copy(alpha = 0.68f),
                        fontSize = 11.sp,
                    )
                }
            } else {
                TextButton(onClick = { onCastVote(false) }) {
                    Text("反对", color = Color.White.copy(alpha = 0.68f), fontSize = 12.sp)
                }
                FilledTonalButton(onClick = { onCastVote(true) }) {
                    Text("同意", fontSize = 12.sp)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LandscapeTransportRail(
    track: Track?,
    room: RoomState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
    layoutScale: Float,
    modifier: Modifier = Modifier,
) {
    val scale = layoutScale.coerceIn(0.78f, 1f)
    var seeking by remember(track?.id) { mutableStateOf(false) }
    var seekPosition by remember(track?.id) { mutableDoubleStateOf(player.positionSeconds) }
    LaunchedEffect(player.positionSeconds) {
        if (!seeking) seekPosition = player.positionSeconds
    }
    val reportedDuration = maxOf(track?.duration ?: 0.0, player.durationSeconds)
    val seekRangeDuration = reportedDuration.coerceAtLeast(1.0)
    val seekThumbSize by animateDpAsState(
        targetValue = ((if (seeking) 10f else 7f) * scale).dp,
        animationSpec = spring(dampingRatio = 0.72f, stiffness = 520f),
        label = "landscape-seek-thumb-size",
    )
    val playInteraction = remember { MutableInteractionSource() }
    val playPressed by playInteraction.collectIsPressedAsState()
    val playButtonScale by animateFloatAsState(
        targetValue = if (playPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.76f, stiffness = 520f),
        label = "landscape-play-button-press",
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = (8f * scale).dp, vertical = (4f * scale).dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Slider(
            value = seekPosition.coerceIn(0.0, seekRangeDuration).toFloat(),
            onValueChange = {
                seeking = true
                seekPosition = it.toDouble()
            },
            onValueChangeFinished = {
                seeking = false
                viewModel.seek(seekPosition)
            },
            valueRange = 0f..seekRangeDuration.toFloat(),
            enabled = track != null && viewModel.canControl(),
            modifier = Modifier
                .weight(1f)
                .height((32f * scale).dp),
            thumb = {
                Box(
                    Modifier
                        .size(seekThumbSize)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = if (seeking) 0.96f else 0.78f)),
                )
            },
            track = { sliderState ->
                SliderDefaults.Track(
                    sliderState = sliderState,
                    modifier = Modifier.height((3f * scale).dp),
                    colors = SliderDefaults.colors(
                        activeTrackColor = Color.White.copy(alpha = 0.72f),
                        inactiveTrackColor = Color.White.copy(alpha = 0.20f),
                    ),
                    thumbTrackGapSize = 0.dp,
                    trackInsideCornerSize = 1.5.dp,
                    drawStopIndicator = null,
                )
            },
        )
        Spacer(Modifier.width((14f * scale).dp))
        Text(
            text =
                "${formatPlayerTime(if (track == null) 0.0 else seekPosition)} / " +
                    formatPlayerTime(reportedDuration),
            modifier = Modifier.widthIn(min = (74f * scale).dp),
            color = Color.White.copy(alpha = 0.56f),
            fontSize = (11f * scale).sp,
            maxLines = 1,
        )
        Spacer(Modifier.width((12f * scale).dp))
        PlayModeMenuButton(
            playMode = room.playMode,
            enabled = track != null,
            scale = scale * (40f / 42f),
            onModeSelected = viewModel::setPlayMode,
        )
        IconButton(
            onClick = viewModel::previous,
            enabled = track != null,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Icon(
                Icons.Default.FastRewind,
                contentDescription = "上一首",
                modifier = Modifier.size((23f * scale).dp),
                tint = Color.White.copy(alpha = 0.84f),
            )
        }
        IconButton(
            onClick = viewModel::togglePlayback,
            enabled = track != null,
            interactionSource = playInteraction,
            modifier = Modifier
                .size((54f * scale).dp)
                .graphicsLayer {
                    scaleX = playButtonScale
                    scaleY = playButtonScale
                }
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.20f)),
        ) {
            Icon(
                if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (player.playing) "暂停" else "播放",
                modifier = Modifier.size((29f * scale).dp),
                tint = Color.White.copy(alpha = 0.94f),
            )
        }
        IconButton(
            onClick = viewModel::next,
            enabled = track != null,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Icon(
                Icons.Default.FastForward,
                contentDescription = "下一首",
                modifier = Modifier.size((23f * scale).dp),
                tint = Color.White.copy(alpha = 0.84f),
            )
        }
        IconButton(
            onClick = onOpenQueue,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Box(Modifier.size((28f * scale).dp)) {
                Icon(
                    Icons.AutoMirrored.Filled.QueueMusic,
                    contentDescription = "打开播放队列",
                    modifier = Modifier.align(Alignment.Center),
                    tint = Color.White.copy(alpha = 0.72f),
                )
                if (room.queue.isNotEmpty()) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .height((15f * scale).dp)
                            .widthIn(min = (15f * scale).dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.90f))
                            .padding(horizontal = (2f * scale).dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = if (room.queue.size > 99) "99+" else room.queue.size.toString(),
                            color = Color.Black,
                            fontSize = (7f * scale).sp,
                            lineHeight = (7f * scale).sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}
