package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import io.github.yueby.musictogether.player.PlayerUiState
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun PortraitPlayerContent(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    lyricsExpanded: Boolean,
    onToggleLyrics: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
    metrics: PlayerLayoutMetrics,
) {
    Column(
        modifier = Modifier
            .widthIn(max = 448.dp)
            .fillMaxHeight()
            .fillMaxWidth()
            .padding(
                horizontal = metrics.horizontalPadding,
                vertical = metrics.verticalPadding,
            ),
    ) {
        SharedTransitionLayout(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            AnimatedContent(
                targetState = lyricsExpanded && track != null,
                transitionSpec = {
                    if (targetState) {
                        (
                            fadeIn(tween(300, delayMillis = 60)) +
                                slideInVertically(tween(300)) { it / 14 }
                            ) togetherWith fadeOut(tween(170))
                    } else {
                        fadeIn(tween(260)) togetherWith (
                            fadeOut(tween(180)) +
                                slideOutVertically(tween(220)) { it / 14 }
                            )
                    }
                },
                modifier = Modifier.fillMaxSize(),
                label = "player-visual",
            ) { showLyrics ->
                if (showLyrics && track != null) {
                    MobileLyricsHero(
                        track = track,
                        lyrics = lyrics,
                        player = player,
                        onShowCover = onToggleLyrics,
                        onOpenChat = onOpenChat,
                        onSeek = viewModel::seek,
                        sharedTransitionScope = this@SharedTransitionLayout,
                        animatedVisibilityScope = this,
                    )
                } else {
                    val visibilityScope = this
                    Column(Modifier.fillMaxSize()) {
                        MobileCoverHero(
                            track = track,
                            onShowLyrics = onToggleLyrics,
                            sharedTransitionScope = this@SharedTransitionLayout,
                            animatedVisibilityScope = visibilityScope,
                            modifier = Modifier.weight(1f).fillMaxWidth(),
                        )
                        Spacer(Modifier.height(metrics.sectionGap))
                        if (track != null) {
                            Box(
                                modifier = with(this@SharedTransitionLayout) {
                                    Modifier.sharedElement(
                                        sharedContentState =
                                            rememberSharedContentState("player-info-${track.id}"),
                                        animatedVisibilityScope = visibilityScope,
                                    )
                                },
                            ) {
                                MobileSongInfo(
                                    track = track,
                                    error = player.error,
                                    onOpenChat = onOpenChat,
                                )
                            }
                        } else {
                            MobileSongInfo(
                                track = null,
                                error = player.error,
                                onOpenChat = onOpenChat,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(if (lyricsExpanded) metrics.compactGap else metrics.sectionGap))
        MobilePlayerControls(
            track = track,
            room = room,
            player = player,
            viewModel = viewModel,
            onOpenQueue = onOpenQueue,
            layoutScale = metrics.controlsScale,
        )
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobileCoverHero(
    track: Track?,
    onShowLyrics: () -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    modifier: Modifier = Modifier,
) {
    val coverInteraction = remember { MutableInteractionSource() }
    val coverPressed by coverInteraction.collectIsPressedAsState()
    val coverScale by animateFloatAsState(
        targetValue = if (coverPressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 420f),
        label = "cover-press-scale",
    )
    BoxWithConstraints(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        val artworkSize = minOf(maxWidth, maxHeight).coerceAtMost(430.dp)
        val cornerRadius by animateDpAsState(
            targetValue = 24.dp,
            animationSpec = spring(dampingRatio = 0.86f, stiffness = 260f),
            label = "cover-corner",
        )
        if (track != null && track.cover.isNotBlank()) {
            AsyncImage(
                model = track.cover,
                contentDescription = "打开歌词",
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .size(artworkSize)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-cover-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                            boundsTransform = { _, _ ->
                                spring(dampingRatio = 0.82f, stiffness = 180f)
                            },
                        )
                }
                    .graphicsLayer {
                        shadowElevation = 18.dp.toPx()
                        shape = RoundedCornerShape(cornerRadius)
                        clip = true
                        scaleX = coverScale
                        scaleY = coverScale
                    }
                    .clickable(
                        interactionSource = coverInteraction,
                        indication = null,
                        onClick = onShowLyrics,
                    ),
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                Modifier
                    .size(artworkSize)
                    .clip(RoundedCornerShape(cornerRadius))
                    .background(Color.White.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.LibraryMusic,
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = Color.White.copy(alpha = 0.72f),
                )
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobileLyricsHero(
    track: Track,
    lyrics: LyricsState,
    player: PlayerUiState,
    onShowCover: () -> Unit,
    onOpenChat: () -> Unit,
    onSeek: (Double) -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val coverInteraction = remember { MutableInteractionSource() }
    val coverPressed by coverInteraction.collectIsPressedAsState()
    val coverScale by animateFloatAsState(
        targetValue = if (coverPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 480f),
        label = "compact-cover-press-scale",
    )
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            AsyncImage(
                model = track.cover,
                contentDescription = "返回封面",
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .size(56.dp)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-cover-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                            boundsTransform = { _, _ ->
                                spring(dampingRatio = 0.82f, stiffness = 180f)
                            },
                        )
                }
                    .graphicsLayer {
                        shadowElevation = 8.dp.toPx()
                        shape = RoundedCornerShape(9.dp)
                        clip = true
                        scaleX = coverScale
                        scaleY = coverScale
                    }
                    .clickable(
                        interactionSource = coverInteraction,
                        indication = null,
                        onClick = onShowCover,
                    ),
                contentScale = ContentScale.Crop,
            )
            Column(
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .weight(1f)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-info-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                        )
                },
            ) {
                Text(
                    text = track.title,
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.94f),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
                Text(
                    text = track.artist.joinToString(" / "),
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.56f),
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
            }
            IconButton(
                onClick = onOpenChat,
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Chat,
                    contentDescription = "打开聊天",
                    tint = Color.White.copy(alpha = 0.72f),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            LyricsPanel(
                lyrics = lyrics,
                positionSeconds = player.positionSeconds,
                isPlaying = player.playing,
                onSeek = onSeek,
                alignToTop = true,
            )
        }
    }
}

@Composable
private fun MobileSongInfo(
    track: Track?,
    error: String?,
    onOpenChat: () -> Unit,
    layoutScale: Float = 1f,
) {
    val scale = layoutScale.coerceIn(0.52f, 1.08f)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = track?.title ?: "暂无歌曲",
                modifier = Modifier.basicMarquee(),
                color = Color.White.copy(alpha = 0.94f),
                fontSize = (20f * scale).sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
            Text(
                text = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                modifier = Modifier.basicMarquee(),
                color = if (error == null) Color.White.copy(alpha = 0.52f) else Color(0xFFFF8A80),
                fontSize = (14f * scale).sp,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
        }
        IconButton(
            onClick = onOpenChat,
            modifier = Modifier.size((40f * scale).dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = "打开聊天",
                modifier = Modifier.size((22f * scale).dp),
                tint = Color.White.copy(alpha = 0.72f),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MobilePlayerControls(
    track: Track?,
    room: RoomState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
    layoutScale: Float = 1f,
) {
    val scale = layoutScale.coerceIn(0.52f, 1.08f)
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
        label = "seek-thumb-size",
    )
    val playInteraction = remember { MutableInteractionSource() }
    val playPressed by playInteraction.collectIsPressedAsState()
    val playButtonScale by animateFloatAsState(
        targetValue = if (playPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.76f, stiffness = 520f),
        label = "play-button-press",
    )

    Column(Modifier.fillMaxWidth()) {
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
                .fillMaxWidth()
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
        Row(Modifier.fillMaxWidth()) {
            Text(
                formatPlayerTime(if (track == null) 0.0 else seekPosition),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = (11f * scale).sp,
            )
            Spacer(Modifier.weight(1f))
            Text(
                formatPlayerTime(reportedDuration),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = (11f * scale).sp,
            )
        }
        Spacer(Modifier.height((16f * scale).dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                PlayModeMenuButton(
                    playMode = room.playMode,
                    enabled = track != null,
                    scale = scale,
                    onModeSelected = viewModel::setPlayMode,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
            ) {
                IconButton(
                    onClick = viewModel::previous,
                    enabled = track != null,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Icon(
                        Icons.Default.FastRewind,
                        contentDescription = "上一首",
                        modifier = Modifier.size((24f * scale).dp),
                        tint = Color.White.copy(alpha = 0.84f),
                    )
                }
                IconButton(
                    onClick = viewModel::togglePlayback,
                    enabled = track != null,
                    interactionSource = playInteraction,
                    modifier = Modifier
                        .size((56f * scale).dp)
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
                        modifier = Modifier.size((30f * scale).dp),
                        tint = Color.White.copy(alpha = 0.94f),
                    )
                }
                IconButton(
                    onClick = viewModel::next,
                    enabled = track != null,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Icon(
                        Icons.Default.FastForward,
                        contentDescription = "下一首",
                        modifier = Modifier.size((24f * scale).dp),
                        tint = Color.White.copy(alpha = 0.84f),
                    )
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                IconButton(
                    onClick = onOpenQueue,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Box(Modifier.size((30f * scale).dp)) {
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
    }
}
