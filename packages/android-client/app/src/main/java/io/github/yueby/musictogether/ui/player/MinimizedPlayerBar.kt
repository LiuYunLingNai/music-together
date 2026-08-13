package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.player.PlayerUiState
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import io.github.yueby.musictogether.ui.designsystem.appGlassSurface
import io.github.yueby.musictogether.ui.designsystem.liquid.lens
import io.github.yueby.musictogether.ui.designsystem.liquid.vibrancy
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.blur
import top.yukonga.miuix.kmp.blur.drawBackdrop
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
    compact: Boolean = false,
) {
    val isMiuix = LocalUiStyle.current == UiStyle.Miuix
    val contentColor = if (isMiuix) MiuixTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface
    val secondaryColor = if (isMiuix) {
        MiuixTheme.colorScheme.onSurfaceVariantSummary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    val enabled = track != null
    if (compact && isMiuix) {
        CompactMiuixPlayerBar(
            track = track,
            playing = player.playing,
            enabled = enabled,
            onExpand = onExpand,
            onTogglePlayback = viewModel::togglePlayback,
            onOpenQueue = onOpenQueue,
            blurBackdrop = blurBackdrop,
            modifier = modifier,
        )
        return
    }
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

    val shape = CircleShape
    val solidContainerColor = if (isMiuix) {
        MiuixTheme.colorScheme.surfaceContainer.copy(alpha = 0.96f)
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.98f)
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = if (isMiuix) 24.dp else 12.dp)
            .height(64.dp)
            .appGlassSurface(if (isMiuix) blurBackdrop else null, shape)
            .then(
                if (isMiuix && blurBackdrop != null) {
                    Modifier
                } else {
                    Modifier.background(solidContainerColor, shape)
                },
            )
            .border(0.75.dp, contentColor.copy(alpha = if (isMiuix) 0.12f else 0.08f), shape)
            .graphicsLayer { alpha = 0.88f + containerProgress.value * 0.12f },
    ) {
        Row(
            modifier = Modifier.matchParentSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onExpand)
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
                        if (isMiuix) {
                            MiuixText(
                                text = track?.title ?: "暂无歌曲",
                                color = contentColor,
                                fontSize = 14.sp,
                                lineHeight = 17.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            MiuixText(
                                text = track?.artist?.joinToString(" / ") ?: "点击打开播放器",
                                color = secondaryColor,
                                fontSize = 11.sp,
                                lineHeight = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        } else {
                            Text(
                                text = track?.title ?: "暂无歌曲",
                                color = contentColor,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = track?.artist?.joinToString(" / ") ?: "点击打开播放器",
                                color = secondaryColor,
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            MiniPlayerIconButton(
                isMiuix = isMiuix,
                onClick = viewModel::togglePlayback,
                enabled = enabled,
                icon = if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (player.playing) "暂停" else "播放",
                tint = if (enabled) contentColor else secondaryColor.copy(alpha = 0.38f),
                modifier = Modifier.graphicsLayer {
                    alpha = controlsProgress.value
                    translationX = (1f - controlsProgress.value) * 8.dp.toPx()
                },
            )
            MiniPlayerIconButton(
                isMiuix = isMiuix,
                onClick = onOpenQueue,
                icon = Icons.AutoMirrored.Filled.QueueMusic,
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
private fun CompactMiuixPlayerBar(
    track: Track?,
    playing: Boolean,
    enabled: Boolean,
    onExpand: () -> Unit,
    onTogglePlayback: () -> Unit,
    onOpenQueue: () -> Unit,
    blurBackdrop: LayerBackdrop?,
    modifier: Modifier = Modifier,
) {
    val shape = CircleShape
    val contentColor = MiuixTheme.colorScheme.onSurface
    val blurActive = blurBackdrop != null
    val containerColor = if (blurActive) {
        MiuixTheme.colorScheme.surfaceContainer.copy(alpha = 0.4f)
    } else {
        MiuixTheme.colorScheme.surfaceContainer
    }
    Box(
        modifier = modifier
            .fillMaxSize()
            .then(
                if (blurBackdrop != null) {
                    Modifier.drawBackdrop(
                        backdrop = blurBackdrop,
                        shape = { shape },
                        effects = {
                            vibrancy()
                            blur(4.dp.toPx(), 4.dp.toPx())
                            lens(
                                refractionHeight = 24.dp.toPx(),
                                refractionAmount = 24.dp.toPx(),
                            )
                        },
                        onDrawSurface = { drawRect(containerColor) },
                    )
                } else {
                    Modifier.background(containerColor, shape)
                },
            )
            .border(0.75.dp, contentColor.copy(alpha = 0.12f), shape),
    ) {
        Row(
            modifier = Modifier.matchParentSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clickable(onClick = onExpand),
            ) {
                PlayerArtwork(
                    track = track,
                    cornerRadius = 24.dp,
                    placeholderIconSize = 21.dp,
                    contentDescription = track?.title ?: "打开播放器",
                    modifier = Modifier.matchParentSize(),
                )
            }
            Spacer(Modifier.weight(1f).clickable(onClick = onExpand))
            MiniPlayerIconButton(
                isMiuix = true,
                onClick = onTogglePlayback,
                enabled = enabled,
                icon = if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (playing) "暂停" else "播放",
                tint = if (enabled) contentColor else contentColor.copy(alpha = 0.38f),
                modifier = Modifier.size(40.dp),
            )
            MiniPlayerIconButton(
                isMiuix = true,
                onClick = onOpenQueue,
                icon = Icons.AutoMirrored.Filled.QueueMusic,
                contentDescription = "打开播放列表",
                tint = contentColor,
                modifier = Modifier.size(40.dp),
            )
        }
    }
}

@Composable
private fun MiniPlayerIconButton(
    isMiuix: Boolean,
    onClick: () -> Unit,
    icon: ImageVector,
    contentDescription: String,
    tint: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    if (isMiuix) {
        MiuixIconButton(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier.size(44.dp),
            minWidth = 44.dp,
            minHeight = 44.dp,
        ) {
            MiuixIcon(icon, contentDescription = contentDescription, tint = tint)
        }
    } else {
        IconButton(onClick = onClick, enabled = enabled, modifier = modifier.size(44.dp)) {
            Icon(icon, contentDescription = contentDescription, tint = tint)
        }
    }
}
