package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.Crossfade
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
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState

private data class LandscapeTrackText(
    val trackId: String?,
    val title: String,
    val subtitle: String,
    val isError: Boolean,
)

@Composable
internal fun LandscapePlayerContent(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    activeVote: VoteState?,
    userId: String?,
    chatUnreadCount: Int,
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
                    chatUnreadCount = chatUnreadCount,
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
                    AnimatedPlayerVotePrompt(
                        vote = activeVote,
                        userId = userId,
                        onCastVote = viewModel::castVote,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(horizontal = 18.dp, vertical = 4.dp),
                    )
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
        PlayerArtwork(
            track = track,
            cornerRadius = 24.dp,
            placeholderIconSize = (artworkSize * 0.28f).coerceAtLeast(40.dp),
            contentDescription = track?.title,
            modifier = Modifier
                .size(artworkSize)
                .graphicsLayer {
                    shadowElevation = 18.dp.toPx()
                    shape = RoundedCornerShape(24.dp)
                    clip = true
                },
        )
    }
}

@Composable
private fun LandscapeSongHeader(
    track: Track?,
    error: String?,
    onOpenChat: () -> Unit,
    chatUnreadCount: Int,
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
        Crossfade(
            targetState = LandscapeTrackText(
                trackId = track?.id,
                title = track?.title ?: "暂无歌曲",
                subtitle = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                isError = error != null,
            ),
            animationSpec = tween(280),
            modifier = Modifier.weight(1f),
            label = "landscape-track-text-crossfade",
        ) { label ->
            Column {
                Text(
                    text = label.title,
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.94f),
                    fontSize = (23f * scale).sp,
                    lineHeight = (27f * scale).sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
                Text(
                    text = label.subtitle,
                    modifier = Modifier.basicMarquee(),
                    color =
                        if (label.isError) Color(0xFFFF8A80) else Color.White.copy(alpha = 0.52f),
                    fontSize = (13f * scale).sp,
                    lineHeight = (17f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
            }
        }
        PlayerChatButton(
            unreadCount = chatUnreadCount,
            onClick = onOpenChat,
            enabled = !chromeVisible,
            modifier = Modifier.size((42f * scale).dp),
            iconAlpha = chatAlpha * 0.72f,
        )
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
    val playInteraction = remember { MutableInteractionSource() }
    val playPressed by playInteraction.collectIsPressedAsState()
    val playButtonScale by animateFloatAsState(
        targetValue = if (playPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.76f, stiffness = 520f),
        label = "landscape-play-button-press",
    )
    var transportCoolingDown by remember(track?.id) { mutableStateOf(false) }
    LaunchedEffect(transportCoolingDown) {
        if (transportCoolingDown) {
            kotlinx.coroutines.delay(500)
            transportCoolingDown = false
        }
    }
    val transportEnabled = track != null && !transportCoolingDown

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = (8f * scale).dp, vertical = (4f * scale).dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerProgressSlider(
            value = seekPosition.coerceIn(0.0, seekRangeDuration).toFloat(),
            maximumValue = seekRangeDuration.toFloat(),
            seeking = seeking,
            enabled = track != null && viewModel.canControl(),
            scale = scale,
            onValueChange = {
                seeking = true
                seekPosition = it.toDouble()
            },
            onValueChangeFinished = {
                seeking = false
                viewModel.seek(seekPosition)
            },
            modifier = Modifier
                .weight(1f),
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
            onClick = {
                transportCoolingDown = true
                viewModel.previous()
            },
            enabled = transportEnabled,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Icon(
                Icons.Default.SkipPrevious,
                contentDescription = "上一首",
                modifier = Modifier.size((23f * scale).dp),
                tint = Color.White.copy(alpha = if (transportEnabled) 0.84f else 0.28f),
            )
        }
        IconButton(
            onClick = {
                transportCoolingDown = true
                viewModel.togglePlayback()
            },
            enabled = transportEnabled,
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
                tint = Color.White.copy(alpha = if (transportEnabled) 0.94f else 0.28f),
            )
        }
        IconButton(
            onClick = {
                transportCoolingDown = true
                viewModel.next()
            },
            enabled = transportEnabled,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Icon(
                Icons.Default.SkipNext,
                contentDescription = "下一首",
                modifier = Modifier.size((23f * scale).dp),
                tint = Color.White.copy(alpha = if (transportEnabled) 0.84f else 0.28f),
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
