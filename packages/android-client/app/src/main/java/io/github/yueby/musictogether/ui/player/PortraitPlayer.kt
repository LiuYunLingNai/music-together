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
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.VoteState
import io.github.yueby.musictogether.player.PlayerUiState

internal data class PortraitTrackText(
    val trackId: String?,
    val title: String,
    val subtitle: String,
    val isError: Boolean = false,
)

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun PortraitPlayerContent(
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
    onToggleLyrics: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
    metrics: PlayerLayoutMetrics,
    primaryContentWidth: Dp,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier = modifier
            .fillMaxHeight()
            .fillMaxWidth()
            .padding(
                horizontal = metrics.horizontalPadding,
                vertical = metrics.verticalPadding,
            ),
    ) {
        val alignedContentWidth by animateDpAsState(
            targetValue = if (lyricsExpanded) maxWidth else minOf(primaryContentWidth, maxWidth),
            animationSpec = spring(dampingRatio = 0.86f, stiffness = 260f),
            label = "portrait-player-aligned-width",
        )
        val lyricTransitionOffsetPx = with(LocalDensity.current) { 20.dp.roundToPx() }
        Column(Modifier.fillMaxSize()) {
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
                                fadeIn(tween(300, easing = LinearOutSlowInEasing)) +
                                    slideInVertically(
                                        tween(300, easing = LinearOutSlowInEasing),
                                    ) { lyricTransitionOffsetPx }
                                ) togetherWith fadeOut(tween(300))
                        } else {
                            fadeIn(tween(300)) togetherWith (
                                fadeOut(tween(300, easing = LinearOutSlowInEasing)) +
                                    slideOutVertically(
                                        tween(300, easing = LinearOutSlowInEasing),
                                    ) { lyricTransitionOffsetPx }
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
                            lyricOffsetMs = lyricOffsetMs,
                            player = player,
                            chatUnreadCount = chatUnreadCount,
                            onShowCover = onToggleLyrics,
                            onOpenChat = onOpenChat,
                            onSeek = viewModel::seek,
                            onSetLyricOffset = { offset -> viewModel.setLyricOffset(track, offset) },
                            sharedTransitionScope = this@SharedTransitionLayout,
                            animatedVisibilityScope = this,
                        )
                    } else {
                        val visibilityScope = this
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxHeight()
                                    .width(alignedContentWidth),
                            ) {
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
                                            chatUnreadCount = chatUnreadCount,
                                            onOpenChat = onOpenChat,
                                        )
                                    }
                                } else {
                                    MobileSongInfo(
                                        track = null,
                                        error = player.error,
                                        chatUnreadCount = chatUnreadCount,
                                        onOpenChat = onOpenChat,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(if (lyricsExpanded) metrics.compactGap else metrics.sectionGap))
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                MobilePlayerControls(
                    track = track,
                    room = room,
                    player = player,
                    viewModel = viewModel,
                    onOpenQueue = onOpenQueue,
                    layoutScale = metrics.controlsScale,
                    modifier = Modifier.width(alignedContentWidth),
                )
            }
        }
        AnimatedPlayerVotePrompt(
            vote = activeVote,
            userId = userId,
            onCastVote = viewModel::castVote,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = alignedContentWidth)
                .padding(bottom = (112f * metrics.controlsScale).dp),
        )
    }
}
