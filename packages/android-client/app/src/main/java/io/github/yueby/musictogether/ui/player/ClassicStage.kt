package io.github.yueby.musictogether.ui.player

import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.TrackLikeState
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val LyricEnterEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
private val PauseShrinkEasing = CubicBezierEasing(0.4f, 0.2f, 0.1f, 1f)
private val PauseResumeEasing = CubicBezierEasing(0.3f, 0.2f, 0.2f, 1.4f)

@Stable
private class StageSlots {
    var root: LayoutCoordinates? = null
    var big: LayoutCoordinates? = null
    var small: LayoutCoordinates? = null
    var bigRect by mutableStateOf<Rect?>(null)
    var smallRect by mutableStateOf<Rect?>(null)
    var rootSize by mutableStateOf(Size.Zero)

    fun refresh() {
        val stage = root?.takeIf { it.isAttached } ?: return
        rootSize = stage.size.toSize()
        big?.takeIf { it.isAttached }?.let { bigRect = stage.localBoundingBoxOf(it, false) }
        small?.takeIf { it.isAttached }?.let { smallRect = stage.localBoundingBoxOf(it, false) }
    }
}

private fun coverTarget(slots: StageSlots, lyricsExpanded: Boolean, immersive: Boolean): Rect? {
    val slot = (if (lyricsExpanded) slots.smallRect else slots.bigRect) ?: return null
    if (slot.width <= 0f || slot.height <= 0f) return null
    val size = if (immersive && !lyricsExpanded) {
        max(max((slot.top + slot.height / 2f) * 2.4f, slots.rootSize.width * 1.2f), min(slot.width, slot.height))
    } else {
        min(slot.width, slot.height)
    }
    return Rect(
        left = slot.left + (slot.width - size) / 2f,
        top = slot.top + (slot.height - size) / 2f,
        right = slot.left + (slot.width + size) / 2f,
        bottom = slot.top + (slot.height + size) / 2f,
    )
}

/**
 * Single persistent cover node (web `usePortraitCoverFrame` / AMLL `VerticalLayout`): it springs between the
 * big and compact slot rects, optionally grows into the immersive full-bleed cover and shrinks while paused.
 */
@Composable
private fun StageCover(
    track: Track?,
    slots: StageSlots,
    lyricsExpanded: Boolean,
    immersive: Boolean,
    playing: Boolean,
    videoUrl: String?,
    onClick: () -> Unit,
) {
    val immersiveNow = immersive && !lyricsExpanded && track != null
    val target = coverTarget(slots, lyricsExpanded, immersiveNow)
    val frame = remember { Animatable(Rect.Zero, Rect.VectorConverter) }
    var placed by remember { mutableStateOf(false) }
    LaunchedEffect(target) {
        val next = target ?: return@LaunchedEffect
        if (!placed) {
            frame.snapTo(next)
            placed = true
        } else {
            frame.animateTo(next, spring(dampingRatio = 1.06f, stiffness = 200f))
        }
    }
    if (!placed) return

    val shrink = immersiveNow && !playing && videoUrl == null
    val pauseScale by animateFloatAsState(
        targetValue = if (shrink) 0.75f else 1f,
        animationSpec = if (shrink) tween(600, easing = PauseShrinkEasing) else tween(500, easing = PauseResumeEasing),
        label = "cover-pause-scale",
    )
    val maskAlpha by animateFloatAsState(if (immersiveNow) 1f else 0f, tween(400), label = "cover-immersive-mask")
    val cornerRadius by animateDpAsState(
        targetValue = if (lyricsExpanded) 8.dp else 24.dp,
        animationSpec = spring(dampingRatio = 0.86f, stiffness = 260f),
        label = "cover-corner",
    )
    Box(
        modifier = Modifier
            .offset { IntOffset(frame.value.left.roundToInt(), frame.value.top.roundToInt()) }
            .layout { measurable, _ ->
                val w = frame.value.width.roundToInt().coerceAtLeast(0)
                val h = frame.value.height.roundToInt().coerceAtLeast(0)
                val placeable = measurable.measure(Constraints.fixed(w, h))
                layout(w, h) { placeable.place(0, 0) }
            }
            .clickable(
                enabled = track != null,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .graphicsLayer {
                scaleX = pauseScale
                scaleY = pauseScale
                shadowElevation = 16.dp.toPx() * (1f - maskAlpha)
                shape = RoundedCornerShape(cornerRadius.toPx())
                clip = true
                compositingStrategy = CompositingStrategy.Offscreen
            }
            .drawWithContent {
                drawContent()
                if (maskAlpha > 0.001f) {
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to Color.Black,
                            0.7f to Color.Black,
                            1f to Color.Black.copy(alpha = 1f - maskAlpha),
                        ),
                        blendMode = BlendMode.DstIn,
                    )
                }
            },
    ) {
        PlayerArtwork(
            track = track,
            cornerRadius = 0.dp,
            placeholderIconSize = if (lyricsExpanded) 24.dp else 72.dp,
            contentDescription = when {
                track == null -> null
                lyricsExpanded -> "返回封面"
                else -> "打开歌词"
            },
            modifier = Modifier.fillMaxSize(),
            decodeSize = 1024,
            platformBadge = false,
        )
        if (videoUrl != null && immersiveNow) CoverVideo(videoUrl, Modifier.fillMaxSize())
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun ClassicPortraitStage(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    activeVote: VoteState?,
    userId: String?,
    chatUnreadCount: Int,
    lyricsExpanded: Boolean,
    immersive: Boolean,
    videoUrl: String?,
    onToggleLyrics: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenArtist: (source: String, id: String) -> Unit,
    like: TrackLikeState?,
    onToggleLike: () -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val layoutDirection = LocalLayoutDirection.current
    val density = LocalDensity.current
    val slots = remember { StageSlots() }
    val showLyrics = lyricsExpanded && track != null
    val padH by animateDpAsState(if (showLyrics) 20.dp else 28.dp, tween(300), label = "stage-pad-h")
    val padV by animateDpAsState(if (showLyrics) 20.dp else 24.dp, tween(300), label = "stage-pad-v")
    val lyricRise = with(density) { 32.dp.roundToPx() }
    val lyricDrop = with(density) { 24.dp.roundToPx() }
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .onGloballyPositioned {
                slots.root = it
                slots.refresh()
            },
    ) {
        val innerWidth = maxWidth - contentPadding.calculateStartPadding(layoutDirection) -
            contentPadding.calculateEndPadding(layoutDirection)
        val innerHeight = maxHeight - contentPadding.calculateTopPadding() - contentPadding.calculateBottomPadding()
        val columnWidth = minOf(innerWidth - padH * 2, 448.dp).coerceAtLeast(0.dp)
        val gap = (
            if (innerHeight <= 760.dp) (innerHeight.value * 0.026f).coerceIn(10f, 18f)
            else (innerHeight.value * 0.03f).coerceIn(12f, 32f)
            ).dp
        val scale = (columnWidth.value / 300f).coerceIn(0.8f, 2f)

        StageCover(
            track = track,
            slots = slots,
            lyricsExpanded = showLyrics,
            immersive = immersive,
            playing = player.playing,
            videoUrl = videoUrl,
            onClick = onToggleLyrics,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    top = contentPadding.calculateTopPadding() + padV,
                    bottom = contentPadding.calculateBottomPadding() + padV,
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SharedTransitionLayout(Modifier.weight(1f).width(columnWidth)) {
            AnimatedContent(
                targetState = showLyrics,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    if (targetState) {
                        (fadeIn(tween(650, delayMillis = 80, easing = LyricEnterEasing)) +
                            slideInVertically(tween(650, delayMillis = 80, easing = LyricEnterEasing)) { lyricRise }) togetherWith
                            (fadeOut(tween(250)) + slideOutVertically(tween(300)) { -lyricDrop })
                    } else {
                        fadeIn(tween(320, delayMillis = 90)) togetherWith
                            (fadeOut(tween(300)) + slideOutVertically(tween(400, easing = LyricEnterEasing)) { lyricDrop })
                    }
                },
                label = "stage-view",
            ) { lyricsShown ->
                val songInfoShared = Modifier.sharedBounds(
                    sharedContentState = rememberSharedContentState(key = "song-info"),
                    animatedVisibilityScope = this@AnimatedContent,
                    boundsTransform = BoundsTransform { _, _ -> tween(700, easing = LyricEnterEasing) },
                )
                if (lyricsShown && track != null) {
                    StageLyricsView(
                        titleModifier = songInfoShared,
                        track = track,
                        lyrics = lyrics,
                        lyricOffsetMs = lyricOffsetMs,
                        player = player,
                        slots = slots,
                        onSeek = viewModel::seek,
                    )
                } else {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(
                            Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .onGloballyPositioned {
                                    slots.big = it
                                    slots.refresh()
                                },
                        )
                        Spacer(Modifier.height(gap))
                        MobileSongInfo(
                            track = track,
                            error = player.error,
                            modifier = Modifier.fillMaxWidth(),
                            textModifier = songInfoShared,
                            layoutScale = scale,
                            onOpenArtist = track?.artistIds?.firstOrNull()
                                ?.takeIf { track.source == "netease" }
                                ?.let { id -> { onOpenArtist(track.source, id) } },
                            like = like,
                            onToggleLike = onToggleLike,
                        )
                    }
                }
            }
            }
            Spacer(Modifier.height(gap))
            MobilePlayerControls(
                track = track,
                room = room,
                player = player,
                viewModel = viewModel,
                onOpenQueue = onOpenQueue,
                layoutScale = scale,
                modifier = Modifier.width(columnWidth),
            )
        }
        AnimatedPlayerVotePrompt(
            vote = activeVote,
            userId = userId,
            onCastVote = viewModel::castVote,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = columnWidth)
                .padding(bottom = contentPadding.calculateBottomPadding() + 8.dp),
        )
    }
}

@Composable
private fun StageLyricsView(
    titleModifier: Modifier,
    track: Track,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    player: PlayerUiState,
    slots: StageSlots,
    onSeek: (Double) -> Unit,
) {
    MobileLyricsHero(
        track = track,
        lyrics = lyrics,
        lyricOffsetMs = lyricOffsetMs,
        player = player,
        onSeek = onSeek,
        titleModifier = titleModifier,
        coverSlot = Modifier.onGloballyPositioned {
            slots.small = it
            slots.refresh()
        },
    )
}

@Composable
internal fun ClassicLandscapeStage(
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
    onOpenArtist: (source: String, id: String) -> Unit,
    like: TrackLikeState?,
    onToggleLike: () -> Unit,
    metrics: PlayerLayoutMetrics,
) {
    var coverCenterY by remember { mutableStateOf<Float?>(null) }
    var lyricBounds by remember { mutableStateOf<Rect?>(null) }
    val lyricAlign = lyricBounds?.takeIf { it.height > 0f }?.let { box ->
        coverCenterY?.let { ((it - box.top) / box.height).coerceIn(0f, 1f) }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val leftWidth = (maxWidth - metrics.horizontalPadding * 2 - metrics.columnGap) * 0.40f
    val columnMax = minOf(leftWidth, 448.dp).coerceAtLeast(0.dp)
    val scale = (columnMax.value / 300f).coerceIn(0.6f, 2f)
    Row(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = metrics.horizontalPadding, vertical = metrics.verticalPadding),
    ) {
        Column(
            modifier = Modifier
                .weight(0.40f)
                .fillMaxHeight(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoxWithConstraints(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                val size = minOf(maxWidth, maxHeight).coerceAtMost(520.dp).coerceAtLeast(0.dp)
                PlayerArtwork(
                    track = track,
                    cornerRadius = 24.dp,
                    placeholderIconSize = (size * 0.28f).coerceAtLeast(40.dp),
                    contentDescription = track?.title,
                    decodeSize = 1024,
                    platformBadge = false,
                    modifier = Modifier
                        .size(size)
                        .onGloballyPositioned { coverCenterY = it.boundsInRoot().center.y }
                        .graphicsLayer {
                            shadowElevation = 18.dp.toPx()
                            shape = RoundedCornerShape(24.dp)
                            clip = true
                        },
                )
            }
            Spacer(Modifier.height(metrics.compactGap))
            MobileSongInfo(
                track = track,
                error = player.error,
                layoutScale = scale,
                modifier = Modifier.widthIn(max = columnMax),
                onOpenArtist = track?.artistIds?.firstOrNull()
                    ?.takeIf { track.source == "netease" }
                    ?.let { id -> { onOpenArtist(track.source, id) } },
                like = like,
                onToggleLike = onToggleLike,
                chatUnreadCount = chatUnreadCount,
                onOpenChat = onOpenChat,
            )
            Spacer(Modifier.height(metrics.sectionGap))
            MobilePlayerControls(
                track = track,
                room = room,
                player = player,
                viewModel = viewModel,
                onOpenQueue = onOpenQueue,
                layoutScale = scale,
                modifier = Modifier.widthIn(max = columnMax),
            )
        }
        Spacer(Modifier.width(metrics.columnGap))
        Box(
            modifier = Modifier
                .weight(0.60f)
                .fillMaxHeight(),
        ) {
            Box(Modifier.fillMaxSize().onGloballyPositioned { lyricBounds = it.boundsInRoot() }.lyricFadeMask()) {
                LyricsPanel(
                    alignOverride = lyricAlign.takeIf { LocalPlayerDisplaySettings.current.lyricAutoAlign },
                    lyrics = lyrics,
                    positionSeconds = player.positionSeconds,
                    lyricOffsetMs = lyricOffsetMs,
                    isPlaying = player.playing,
                    onSeek = { lyricTimeSeconds -> viewModel.seek(lyricTimeSeconds + lyricOffsetMs / 1_000.0) },
                )
            }
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
}
