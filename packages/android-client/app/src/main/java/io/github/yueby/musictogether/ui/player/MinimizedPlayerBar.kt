package io.github.yueby.musictogether.ui.player

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ListMusic
import com.composables.icons.lucide.Pause
import com.composables.icons.lucide.Play
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import io.github.yueby.musictogether.ui.designsystem.liquid.liquidGlassSurface
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun MinimizedPlayerBar(
    track: Track?,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onExpand: () -> Unit,
    onOpenQueue: () -> Unit,
    modifier: Modifier = Modifier,
    blurBackdrop: LayerBackdrop? = null,
    lyrics: LyricsState = LyricsState(),
    lyricOffsetMs: Int = 0,
) {
    val contentColor = MiuixTheme.colorScheme.onSurface
    val secondaryColor = MiuixTheme.colorScheme.onSurfaceVariantSummary
    val enabled = track != null
    val minimizeTransition = LocalPlayerMinimizeTransition.current
    val minimizedTarget = minimizeTransition?.minimizedTarget ?: true
    val initialProgress = if (
        minimizeTransition?.transitionRunning == true &&
        minimizeTransition.minimizedTarget
    ) {
        0f
    } else {
        1f
    }
    val containerProgress = remember(minimizeTransition?.roomId) { Animatable(initialProgress) }
    val artworkProgress = remember(minimizeTransition?.roomId) { Animatable(initialProgress) }
    val infoProgress = remember(minimizeTransition?.roomId) { Animatable(initialProgress) }
    val controlsProgress = remember(minimizeTransition?.roomId) { Animatable(initialProgress) }

    LaunchedEffect(minimizedTarget) {
        val target = if (minimizedTarget) 1f else 0f
        coroutineScope {
            launch {
                containerProgress.animateTo(
                    targetValue = target,
                    animationSpec = tween(
                        durationMillis = if (minimizedTarget) 220 else 130,
                        easing = LinearOutSlowInEasing,
                    ),
                )
            }
            launch {
                if (minimizedTarget) delay(25)
                artworkProgress.animateTo(
                    targetValue = target,
                    animationSpec = spring(dampingRatio = 0.80f, stiffness = 320f),
                )
            }
            launch {
                if (minimizedTarget) delay(65)
                infoProgress.animateTo(
                    targetValue = target,
                    animationSpec = tween(
                        durationMillis = if (minimizedTarget) 220 else 110,
                        easing = LinearOutSlowInEasing,
                    ),
                )
            }
            launch {
                if (minimizedTarget) delay(105)
                controlsProgress.animateTo(
                    targetValue = target,
                    animationSpec = tween(
                        durationMillis = if (minimizedTarget) 190 else 90,
                        easing = LinearOutSlowInEasing,
                    ),
                )
            }
        }
    }

    val lyricLine = remember(lyrics, track?.id, lyricOffsetMs, (player.positionSeconds * 4).toLong()) {
        if (track == null || lyrics.trackId != track.id) return@remember null
        val at = (player.positionSeconds * 1000).toLong() - lyricOffsetMs
        lyrics.lines.lastOrNull { !it.isBackground && it.startTimeMs <= at }?.text?.trim()?.takeIf { it.isNotEmpty() }
    }
    val subtitle = player.localPlaybackStatus ?: lyricLine ?: track?.artist?.joinToString(" / ") ?: "点击打开播放器"
    val playbackProgress by animateFloatAsState(
        targetValue = if (player.durationSeconds > 0) {
            (player.positionSeconds / player.durationSeconds).toFloat().coerceIn(0f, 1f)
        } else {
            0f
        },
        animationSpec = tween(250, easing = LinearEasing),
        label = "mini-player-progress",
    )
    val shape = CircleShape
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val press by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.5f, stiffness = 380f),
        label = "mini-player-press",
    )
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .height(64.dp)
            .liquidGlassSurface(blurBackdrop, shape) { press }
            .graphicsLayer { alpha = 0.88f + containerProgress.value * 0.12f },
    ) {
        Row(
            modifier = Modifier.matchParentSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable(interactionSource = interaction, indication = null, onClick = onExpand)
                    .padding(end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .graphicsLayer {
                            val progress = artworkProgress.value
                            alpha = progress
                            scaleX = 0.84f + progress * 0.16f
                            scaleY = 0.84f + progress * 0.16f
                            translationX = (1f - progress) * -10.dp.toPx()
                        },
                ) {
                    PlayerArtwork(
                        track = track,
                        cornerRadius = 18.dp,
                        placeholderIconSize = 21.dp,
                        contentDescription = track?.title,
                        modifier = Modifier.matchParentSize(),
                    )
                }
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 10.dp)
                        .graphicsLayer {
                            val progress = infoProgress.value
                            alpha = progress
                            translationY = (1f - progress) * 6.dp.toPx()
                        },
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Column {
                        MiuixText(
                            text = track?.title ?: "暂无歌曲",
                            color = contentColor,
                            fontSize = 14.sp,
                            lineHeight = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Crossfade(targetState = subtitle, animationSpec = tween(220), label = "mini-player-subtitle") { text ->
                            MiuixText(
                                text = text,
                                color = secondaryColor,
                                fontSize = 11.sp,
                                lineHeight = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            MiniPlayerIconButton(
                onClick = viewModel::togglePlayback,
                enabled = enabled,
                icon = if (player.controlPlaying) Lucide.Pause else Lucide.Play,
                contentDescription = player.controlDescription,
                tint = if (enabled) contentColor else secondaryColor.copy(alpha = 0.38f),
                modifier = Modifier
                    .graphicsLayer {
                        alpha = controlsProgress.value
                        translationX = (1f - controlsProgress.value) * 8.dp.toPx()
                    }
                    .drawBehind {
                        val diameter = 36.dp.toPx()
                        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                        val ring = Size(diameter, diameter)
                        drawArc(contentColor.copy(alpha = 0.14f), 0f, 360f, false, topLeft, ring, style = Stroke(2.dp.toPx()))
                        drawArc(
                            contentColor,
                            -90f,
                            360f * playbackProgress,
                            false,
                            topLeft,
                            ring,
                            style = Stroke(2.dp.toPx(), cap = StrokeCap.Round),
                        )
                    },
            )
            MiniPlayerIconButton(
                onClick = onOpenQueue,
                icon = Lucide.ListMusic,
                contentDescription = "打开播放列表",
                tint = contentColor,
                modifier = Modifier.graphicsLayer {
                    alpha = controlsProgress.value
                    translationX = (1f - controlsProgress.value) * 12.dp.toPx()
                },
            )
        }
    }
}

@Composable
private fun MiniPlayerIconButton(
    onClick: () -> Unit,
    icon: ImageVector,
    contentDescription: String,
    tint: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    MiuixIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.size(44.dp),
        minWidth = 44.dp,
        minHeight = 44.dp,
    ) {
        MiuixIcon(icon, contentDescription = contentDescription, tint = tint)
    }
}
