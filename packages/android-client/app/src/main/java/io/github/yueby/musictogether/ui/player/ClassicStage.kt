package io.github.yueby.musictogether.ui.player

import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.ui.graphics.TransformOrigin
import kotlin.math.ceil
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.animation.core.CubicBezierEasing
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.filterNotNull
import kotlin.math.abs
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
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.unit.Dp
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

private val LyricEnterEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
private val PauseShrinkEasing = CubicBezierEasing(0.4f, 0.2f, 0.1f, 1f)
private val PauseResumeEasing = CubicBezierEasing(0.3f, 0.2f, 0.2f, 1.4f)
/** AMLL `VerticalLayout` cover spring. */
private const val CoverStiffness = 200f
private const val CoverDamping = 30f

private fun coverDistance(a: Rect, b: Rect): Float =
    max(max(abs(a.left - b.left), abs(a.top - b.top)), max(abs(a.right - b.right), abs(a.bottom - b.bottom)))

@Stable
private class StageSlots {
    var root: LayoutCoordinates? = null
    var big: LayoutCoordinates? = null
    var small: LayoutCoordinates? = null
    var bigRect by mutableStateOf<Rect?>(null)
    var smallRect by mutableStateOf<Rect?>(null)
    var rootSize by mutableStateOf(Size.Zero)
    var bigInfo by mutableStateOf<Rect?>(null)
    var smallInfo by mutableStateOf<Rect?>(null)

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
    var frame by remember { mutableStateOf(Rect.Zero) }
    var placed by remember { mutableStateOf(false) }
    // The cover is laid out once per move at the larger of its two sizes and only its layer animates, so a
    // move neither remeasures the image nor reallocates the layer on every frame.
    var layoutSize by remember { mutableIntStateOf(1) }
    val latestTarget by rememberUpdatedState(target)
    LaunchedEffect(Unit) {
        // One spring carried across retargets. Retargeting only moves the goal: the flight itself is never
        // cancelled, so a sub-pixel slot change mid-flight cannot strand the cover half way.
        val velocity = FloatArray(4)
        var goal: Rect? = null
        val wake = Channel<Unit>(Channel.CONFLATED)
        launch {
            snapshotFlow { latestTarget }.filterNotNull().collect { next ->
                if (!placed) {
                    layoutSize = ceil(next.width).toInt().coerceAtLeast(1)
                    frame = next
                    goal = next
                    placed = true
                    return@collect
                }
                // Web `DEAD_ZONE_PX`: sub-pixel feedback between the controls and the slot is not a move.
                if (goal?.let { coverDistance(it, next) <= 1.5f } == true) return@collect
                goal = next
                layoutSize = max(layoutSize, ceil(max(next.width, frame.width)).toInt())
                wake.trySend(Unit)
            }
        }
        for (signal in wake) {
            var lastFrameNanos = 0L
            while (true) {
                val now = withFrameNanos { it }
                val elapsed = if (lastFrameNanos == 0L) 0.016f else ((now - lastFrameNanos) / 1e9f).coerceIn(0f, 0.034f)
                lastFrameNanos = now
                val to = goal ?: break
                val target = floatArrayOf(to.left, to.top, to.right, to.bottom)
                val at = floatArrayOf(frame.left, frame.top, frame.right, frame.bottom)
                val steps = ceil(elapsed / 0.004f).toInt().coerceAtLeast(1)
                val step = elapsed / steps
                repeat(steps) {
                    for (i in 0..3) {
                        velocity[i] += (CoverStiffness * (target[i] - at[i]) - CoverDamping * velocity[i]) * step
                        at[i] += velocity[i] * step
                    }
                }
                if ((0..3).all { abs(target[it] - at[it]) < 0.5f && abs(velocity[it]) < 5f }) {
                    frame = to
                    velocity.fill(0f)
                    layoutSize = ceil(to.width).toInt().coerceAtLeast(1)
                    break
                }
                frame = Rect(at[0], at[1], at[2], at[3])
            }
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
            .layout { measurable, constraints ->
                val placeable = measurable.measure(Constraints.fixed(layoutSize, layoutSize))
                // Reporting more than the stage allows would get the cover re-centred by the parent.
                layout(min(layoutSize, constraints.maxWidth), min(layoutSize, constraints.maxHeight)) {
                    placeable.place(0, 0)
                }
            }
            .graphicsLayer {
                val fit = frame.width / size.width
                val shrink = (1f - pauseScale) / 2f
                transformOrigin = TransformOrigin(0f, 0f)
                translationX = frame.left + frame.width * shrink
                translationY = frame.top + frame.height * shrink
                scaleX = fit * pauseScale
                scaleY = fit * pauseScale
                shadowElevation = 16.dp.toPx() * (1f - maskAlpha)
                shape = RoundedCornerShape(cornerRadius.toPx() / fit.coerceAtLeast(0.01f))
                clip = true
                compositingStrategy = CompositingStrategy.Offscreen
            }
            .clickable(
                enabled = track != null,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
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
        // AMLL `VerticalLayout` side columns: a narrow inset on phones, 3em beyond 480. Both views share one
        // inset and one bottom margin so the controls never move when the view switches.
        val wide = innerWidth > 480.dp
        val padH = if (wide) 48.dp else 24.dp
        val padTop = if (wide) 28.dp else 20.dp
        val padBottom = if (wide) 40.dp else 28.dp
        val columnWidth = minOf(innerWidth - padH * 2, 640.dp).coerceAtLeast(0.dp)
        val gap = (
            if (innerHeight <= 760.dp) (innerHeight.value * 0.026f).coerceIn(10f, 18f)
            else (innerHeight.value * 0.03f).coerceIn(12f, 32f)
            ).dp
        val scale = (columnWidth.value / 300f).coerceIn(0.8f, 1.5f)

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
                    top = contentPadding.calculateTopPadding() + padTop,
                    bottom = contentPadding.calculateBottomPadding() + padBottom,
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // AMLL `VerticalLayout`: both views stay mounted and only trade opacity, so the slots the cover
            // springs between never move and switching never builds the lyric list.
            Box(Modifier.weight(1f).width(columnWidth)) {
                val lyricAlpha by animateFloatAsState(
                    targetValue = if (showLyrics) 1f else 0f,
                    animationSpec = if (showLyrics) tween(500, delayMillis = 500) else tween(500),
                    label = "stage-lyric-alpha",
                )
                val smallInfoAlpha by animateFloatAsState(
                    targetValue = if (showLyrics) 1f else 0f,
                    animationSpec = if (showLyrics) tween(250, delayMillis = 250) else tween(500),
                    label = "stage-small-info-alpha",
                )
                // main `layoutId="song-info"`: the title travels between its two places while they cross-fade.
                val infoShift by animateFloatAsState(
                    targetValue = if (showLyrics) 1f else 0f,
                    animationSpec = tween(700, easing = LyricEnterEasing),
                    label = "stage-info-shift",
                )
                val bigInfoAlpha by animateFloatAsState(
                    targetValue = if (showLyrics) 0f else 1f,
                    animationSpec = tween(500),
                    label = "stage-big-info-alpha",
                )
                if (track != null) {
                    val parked = !showLyrics && lyricAlpha == 0f
                    StageLyricsView(
                        titleModifier = Modifier
                            .onGloballyPositioned { slots.smallInfo = it.boundsInRoot() }
                            .graphicsLayer {
                                alpha = smallInfoAlpha
                                travel(slots.smallInfo, slots.bigInfo, 1f - infoShift)
                            },
                        // AMLL lets the lyric area span the side columns, which puts the text on the cover edge.
                        coverSize = if (wide) 96.dp else 72.dp,
                        // A hidden list is moved out of reach so it cannot take touches meant for the cover view.
                        lyricsModifier = Modifier
                            .layout { measurable, constraints ->
                                val bleed = 20.dp.roundToPx()
                                val placeable = measurable.measure(
                                    constraints.copy(
                                        minWidth = constraints.maxWidth + bleed * 2,
                                        maxWidth = constraints.maxWidth + bleed * 2,
                                    ),
                                )
                                layout(constraints.maxWidth, placeable.height) {
                                    placeable.place(-bleed, if (parked) constraints.maxHeight * 4 else 0)
                                }
                            }
                            .graphicsLayer { alpha = lyricAlpha },
                        track = track,
                        lyrics = lyrics,
                        lyricOffsetMs = lyricOffsetMs,
                        player = player,
                        slots = slots,
                        onSeek = { seconds -> track?.id?.let { viewModel.seekTrack(seconds, it) } },
                    )
                }
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
                    val infoParked = showLyrics && bigInfoAlpha == 0f
                    MobileSongInfo(
                        track = track,
                        error = player.error,
                        modifier = Modifier
                            .fillMaxWidth()
                            .layout { measurable, constraints ->
                                val placeable = measurable.measure(constraints)
                                layout(placeable.width, placeable.height) {
                                    placeable.place(0, if (infoParked) placeable.height * 40 else 0)
                                }
                            }
                            .graphicsLayer { alpha = bigInfoAlpha },
                        textModifier = Modifier
                            .onGloballyPositioned { if (!infoParked) slots.bigInfo = it.boundsInRoot() }
                            .graphicsLayer { travel(slots.bigInfo, slots.smallInfo, infoShift) },
                        layoutScale = scale,
                        onOpenArtist = track?.artistIds?.firstOrNull()
                            ?.takeIf { track.source == "netease" }
                            ?.let { id -> { onOpenArtist(track.source, id) } },
                        like = like,
                        onToggleLike = onToggleLike,
                    )
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

/** Moves a layer from its own rect toward [other] by [fraction], matching heights on the way. */
private fun GraphicsLayerScope.travel(own: Rect?, other: Rect?, fraction: Float) {
    if (own == null || other == null || own.height <= 0f || fraction <= 0f) return
    transformOrigin = TransformOrigin(0f, 0f)
    translationX = (other.left - own.left) * fraction
    translationY = (other.top - own.top) * fraction
    val scale = 1f + (other.height / own.height - 1f) * fraction
    scaleX = scale
    scaleY = scale
}

@Composable
private fun StageLyricsView(
    titleModifier: Modifier,
    coverSize: Dp,
    lyricsModifier: Modifier,
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
        coverSize = coverSize,
        lyricsModifier = lyricsModifier,
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
                    onSeek = { lyricTimeSeconds -> track?.id?.let {
                        viewModel.seekTrack(lyricTimeSeconds + lyricOffsetMs / 1_000.0, it)
                    } },
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
