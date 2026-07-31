package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.ExperimentalSharedTransitionApi
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState
@Composable
internal fun PlayerPane(
    room: RoomState,
    lyrics: LyricsState,
    lyricOffsets: Map<String, Int>,
    activeVote: VoteState?,
    userId: String?,
    chatUnreadCount: Int,
    visualMotionEnabled: Boolean,
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
        chatUnreadCount = chatUnreadCount,
        visualMotionEnabled = visualMotionEnabled,
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

internal fun portraitPlayerContentWidth(containerWidth: Dp): Dp {
    val sideGutter = ((containerWidth.value - 600f) * 0.1f)
        .coerceIn(0f, 48f)
        .dp
    return (containerWidth - sideGutter * 2)
        .coerceAtMost(760.dp)
        .coerceAtLeast(0.dp)
}

internal fun portraitPlayerPrimaryContentWidth(
    contentWidth: Dp,
    containerHeight: Dp,
): Dp {
    val heightConstrainedWidth = (containerHeight - 240.dp).coerceAtLeast(280.dp)
    return minOf(contentWidth, heightConstrainedWidth, 560.dp)
        .coerceAtLeast(0.dp)
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
    chatUnreadCount: Int,
    visualMotionEnabled: Boolean,
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
    val minimizeTransition = LocalPlayerMinimizeTransition.current
    val playerShape = RoundedCornerShape(16.dp)
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .padding(if (immersiveLandscape) 0.dp else 8.dp)
            .clip(if (immersiveLandscape) RoundedCornerShape(0.dp) else playerShape)
            .background(Color(0xFF111111)),
    ) {
        PlayerBackdrop(
            coverUrl = track?.cover,
            playing = player.playing,
            motionAllowed =
                visualMotionEnabled && minimizeTransition?.transitionRunning != true,
            shortestSide = minOf(maxWidth, maxHeight),
            modifier = Modifier.fillMaxSize(),
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
                val contentWidth = portraitPlayerContentWidth(maxWidth)
                val primaryContentWidth =
                    portraitPlayerPrimaryContentWidth(contentWidth, maxHeight)
                PortraitPlayerContent(
                    track = track,
                    room = room,
                    lyrics = lyrics,
                    lyricOffsetMs = lyricOffsetMs,
                    player = player,
                    viewModel = viewModel,
                    activeVote = activeVote,
                    userId = userId,
                    chatUnreadCount = chatUnreadCount,
                    lyricsExpanded = lyricsExpanded,
                    onToggleLyrics = onToggleLyrics,
                    onOpenQueue = onOpenQueue,
                    onOpenChat = onOpenChat,
                    metrics = metrics,
                    primaryContentWidth = primaryContentWidth,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .width(contentWidth),
                )
            } else {
                LandscapePlayerContent(
                    track = track,
                    room = room,
                    lyrics = lyrics,
                    lyricOffsetMs = lyricOffsetMs,
                    activeVote = activeVote,
                    userId = userId,
                    chatUnreadCount = chatUnreadCount,
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
