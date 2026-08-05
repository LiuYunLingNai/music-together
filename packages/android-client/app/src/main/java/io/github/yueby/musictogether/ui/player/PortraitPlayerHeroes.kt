package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.Crossfade
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import kotlin.math.roundToInt

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun MobileCoverHero(
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
        PlayerArtwork(
            track = track,
            cornerRadius = cornerRadius,
            placeholderIconSize = 72.dp,
            contentDescription = if (track == null) null else "打开歌词",
            modifier = with(sharedTransitionScope) {
                Modifier
                    .size(artworkSize)
                    .sharedElement(
                        sharedContentState =
                            rememberSharedContentState("player-cover-${track?.id ?: "empty"}"),
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
                    enabled = track != null,
                    interactionSource = coverInteraction,
                    indication = null,
                    onClick = onShowLyrics,
                ),
        )
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun MobileLyricsHero(
    track: Track,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    player: PlayerUiState,
    chatUnreadCount: Int,
    onShowCover: () -> Unit,
    onOpenChat: () -> Unit,
    onSeek: (Double) -> Unit,
    onSetLyricOffset: (Int) -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    var lyricOffsetPanelVisible by remember(track.id) { mutableStateOf(false) }
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
            PlayerArtwork(
                track = track,
                cornerRadius = 9.dp,
                placeholderIconSize = 24.dp,
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
            )
            Crossfade(
                targetState = PortraitTrackText(
                    trackId = track.id,
                    title = track.title,
                    subtitle = track.artist.joinToString(" / "),
                ),
                animationSpec = tween(280),
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .weight(1f)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-info-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                        )
                },
                label = "compact-track-text-crossfade",
            ) { label ->
                Column {
                    Text(
                        text = label.title,
                        modifier = Modifier.basicMarquee(),
                        color = Color.White.copy(alpha = 0.94f),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                    Text(
                        text = label.subtitle,
                        modifier = Modifier.basicMarquee(),
                        color = Color.White.copy(alpha = 0.56f),
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                }
            }
            LyricActionsMenu(
                unreadCount = chatUnreadCount,
                canAdjustLyricOffset = lyricOffsetKey(track) != null,
                onOpenChat = onOpenChat,
                onOpenLyricOffset = { lyricOffsetPanelVisible = true },
            )
        }
        AnimatedVisibility(visible = lyricOffsetPanelVisible) {
            LyricOffsetPanel(
                offsetMs = lyricOffsetMs,
                onDismiss = { lyricOffsetPanelVisible = false },
                onOffsetChange = onSetLyricOffset,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        Spacer(Modifier.height(if (lyricOffsetPanelVisible) 12.dp else 6.dp))
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
                onSeek = { lyricTimeSeconds -> onSeek(lyricTimeSeconds + lyricOffsetMs / 1_000.0) },
                alignToTop = true,
            )
        }
    }
}

@Composable
internal fun LyricActionsMenu(
    unreadCount: Int,
    canAdjustLyricOffset: Boolean,
    onOpenChat: () -> Unit,
    onOpenLyricOffset: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(
            onClick = { expanded = true },
            modifier = Modifier.size(40.dp),
        ) {
            Icon(
                Icons.Default.MoreVert,
                contentDescription = "更多",
                tint = Color.White.copy(alpha = 0.72f),
            )
            if (unreadCount > 0) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 3.dp, end = 2.dp)
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.92f)),
                )
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = {
                    Text(
                        if (unreadCount > 0) "聊天（${unreadCount.coerceAtMost(99)} 条未读）" else "聊天",
                    )
                },
                leadingIcon = {
                    Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                },
                onClick = {
                    expanded = false
                    onOpenChat()
                },
            )
            if (canAdjustLyricOffset) {
                DropdownMenuItem(
                    text = { Text("歌词时间校正") },
                    leadingIcon = {
                        Icon(Icons.Default.Tune, contentDescription = null)
                    },
                    onClick = {
                        expanded = false
                        onOpenLyricOffset()
                    },
                )
            }
        }
    }
}

@Composable
internal fun LyricOffsetPanel(
    offsetMs: Int,
    onDismiss: () -> Unit,
    onOffsetChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var offsetSeconds by remember(offsetMs) { mutableStateOf(offsetMs / 1_000f) }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color.Black.copy(alpha = 0.24f),
        contentColor = Color.White,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "歌词时间校正",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(
                        text = lyricOffsetDescription(offsetMs),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.72f),
                    )
                }
                IconButton(
                    onClick = { onOffsetChange(0) },
                    enabled = offsetMs != 0,
                ) {
                    Icon(
                        Icons.Default.RestartAlt,
                        contentDescription = "重置歌词校正",
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "关闭歌词校正",
                    )
                }
            }
            Slider(
                value = offsetSeconds,
                onValueChange = { value ->
                    offsetSeconds = value
                    onOffsetChange((value * 1_000).roundToInt())
                },
                valueRange = -10f..10f,
                steps = 199,
            )
        }
    }
}

private fun lyricOffsetDescription(offsetMs: Int): String =
    when {
        offsetMs > 0 ->
            "歌词延后 ${String.format(java.util.Locale.getDefault(), "%.1f", offsetMs / 1_000.0)} 秒"

        offsetMs < 0 ->
            "歌词提前 ${String.format(java.util.Locale.getDefault(), "%.1f", -offsetMs / 1_000.0)} 秒"

        else -> "未校正"
    }
