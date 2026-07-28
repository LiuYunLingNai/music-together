package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState
import io.github.yueby.musictogether.ui.rememberCoverImageRequest
@Composable
internal fun PlayerPane(
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsets: Map<String, Int>,
    activeVote: VoteState?,
    userId: String?,
    viewModel: MusicTogetherViewModel,
    immersiveLandscape: Boolean,
    landscapeChromeVisible: Boolean,
    safeContentPadding: PaddingValues,
    onSurfaceTap: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val player by viewModel.playerState.collectAsStateWithLifecycle()
    val track = player.track ?: room.currentTrack
    val lyricOffsetMs = lyricOffsetKey(track)?.let { lyricOffsets[it] } ?: 0
    // Player visual is a room-level preference. Changing tracks must not force
    // users out of the lyrics view.
    var lyricsExpanded by remember(room.id) { mutableStateOf(false) }

    MobilePlayerSurface(
        track = track,
        room = room,
        lyrics = lyrics,
        lyricOffsetMs = lyricOffsetMs,
        activeVote = activeVote,
        userId = userId,
        player = player,
        viewModel = viewModel,
        immersiveLandscape = immersiveLandscape,
        landscapeChromeVisible = landscapeChromeVisible,
        safeContentPadding = safeContentPadding,
        onSurfaceTap = onSurfaceTap,
        lyricsExpanded = lyricsExpanded,
        onToggleLyrics = { lyricsExpanded = !lyricsExpanded },
        onOpenQueue = onOpenQueue,
        onOpenChat = onOpenChat,
    )
}

internal data class PlayerLayoutMetrics(
    val horizontalPadding: Dp,
    val verticalPadding: Dp,
    val sectionGap: Dp,
    val compactGap: Dp,
    val columnGap: Dp,
    val controlsScale: Float,
)

private fun playerLayoutMetrics(width: Dp, height: Dp, portrait: Boolean): PlayerLayoutMetrics {
    return if (portrait) {
        val scale = minOf(
            width.value / 400f,
            height.value / 680f,
        ).coerceIn(0.82f, 1.08f)
        PlayerLayoutMetrics(
            horizontalPadding = (20f * scale).dp,
            verticalPadding = (18f * scale).dp,
            sectionGap = (16f * scale).dp,
            compactGap = (10f * scale).dp,
            columnGap = 0.dp,
            controlsScale = scale,
        )
    } else {
        val inset = (minOf(width.value, height.value) * 0.05f).coerceIn(12f, 28f)
        val scale = minOf(
            width.value / 900f,
            height.value / 420f,
        ).coerceIn(0.72f, 1f)
        PlayerLayoutMetrics(
            horizontalPadding = inset.dp,
            verticalPadding = inset.dp,
            sectionGap = (14f * scale).dp,
            compactGap = (10f * scale).dp,
            columnGap = (width.value * 0.03f).coerceIn(24f, 48f).dp,
            controlsScale = scale,
        )
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobilePlayerSurface(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    activeVote: VoteState?,
    userId: String?,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    immersiveLandscape: Boolean,
    landscapeChromeVisible: Boolean,
    safeContentPadding: PaddingValues,
    onSurfaceTap: () -> Unit,
    lyricsExpanded: Boolean,
    onToggleLyrics: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val playerShape = RoundedCornerShape(16.dp)
    val backgroundScale by animateFloatAsState(
        targetValue = if (player.playing) 1.30f else 1.22f,
        animationSpec = tween(3200),
        label = "background-scale",
    )
    val backgroundFlow = rememberInfiniteTransition(label = "background-flow")
    val backgroundDrift by backgroundFlow.animateFloat(
        initialValue = -1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(12_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "background-drift",
    )
    val backgroundPulse by backgroundFlow.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(9_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "background-pulse",
    )
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .padding(if (immersiveLandscape) 0.dp else 8.dp)
            .clip(if (immersiveLandscape) RoundedCornerShape(0.dp) else playerShape)
            .background(Color(0xFF111111)),
    ) {
        val driftDistancePx = with(LocalDensity.current) {
            (minOf(maxWidth, maxHeight) * 0.035f).toPx()
        }

        if (!track?.cover.isNullOrBlank()) {
            AsyncImage(
                model = rememberCoverImageRequest(track?.cover),
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val flowScale = if (player.playing) backgroundPulse * 0.045f else 0f
                        scaleX = backgroundScale + flowScale
                        scaleY = backgroundScale + flowScale
                        translationX = if (player.playing) backgroundDrift * driftDistancePx else 0f
                        translationY =
                            if (player.playing) -backgroundDrift * driftDistancePx * 0.62f else 0f
                        rotationZ = if (player.playing) backgroundDrift * 0.12f else 0f
                        alpha = 0.68f
                    }
                    .blur(32.dp),
                contentScale = ContentScale.Crop,
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.10f),
                            Color.Black.copy(alpha = 0.38f),
                        ),
                        radius = 1250f,
                    ),
                )
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.18f),
                        0.50f to Color.Black.copy(alpha = 0.04f),
                        1f to Color.Black.copy(alpha = 0.30f),
                    ),
                ),
        )
        if (immersiveLandscape) {
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onSurfaceTap,
                    ),
            )
        }

        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    if (immersiveLandscape) safeContentPadding else PaddingValues(0.dp),
                ),
        ) {
            val portrait = maxHeight >= maxWidth
            val metrics = playerLayoutMetrics(maxWidth, maxHeight, portrait)
            if (portrait) {
                PortraitPlayerContent(
                    track = track,
                    room = room,
                    lyrics = lyrics,
                    lyricOffsetMs = lyricOffsetMs,
                    player = player,
                    viewModel = viewModel,
                    lyricsExpanded = lyricsExpanded,
                    onToggleLyrics = onToggleLyrics,
                    onOpenQueue = onOpenQueue,
                    onOpenChat = onOpenChat,
                    metrics = metrics,
                )
            } else {
                LandscapePlayerContent(
                    track = track,
                    room = room,
                    lyrics = lyrics,
                    lyricOffsetMs = lyricOffsetMs,
                    activeVote = activeVote,
                    userId = userId,
                    player = player,
                    viewModel = viewModel,
                    onOpenQueue = onOpenQueue,
                    onOpenChat = onOpenChat,
                    chromeVisible = landscapeChromeVisible,
                    metrics = metrics,
                )
            }
        }
    }
}
