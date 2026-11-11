package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Matches the upstream player track: a 6 px-equivalent rounded rail with a
 * normally hidden 16 px-equivalent thumb that appears while seeking.
 */
@Composable
internal fun PlayerProgressSlider(
    value: Float,
    maximumValue: Float,
    seeking: Boolean,
    enabled: Boolean,
    scale: Float,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val thumbAlpha by animateFloatAsState(
        targetValue = if (seeking && enabled) 1f else 0f,
        animationSpec = tween(durationMillis = 150),
        label = "player-progress-thumb-alpha",
    )
    val latestChange by rememberUpdatedState(onValueChange)
    val latestFinished by rememberUpdatedState(onValueChangeFinished)
    val range = maximumValue.coerceAtLeast(0.0001f)
    val fraction = (value / range).coerceIn(0f, 1f)
    val trackHeight = (6f * scale).dp
    val thumbSize = (16f * scale).dp
    val thumbPx = with(LocalDensity.current) { thumbSize.toPx() }
    BoxWithConstraints(
        modifier = modifier
            .height((20f * scale).dp)
            .pointerInput(enabled, range) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    latestChange((down.position.x / size.width).coerceIn(0f, 1f) * range)
                    drag(down.id) { change ->
                        change.consume()
                        latestChange((change.position.x / size.width).coerceIn(0f, 1f) * range)
                    }
                    latestFinished()
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(trackHeight)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.25f)),
        )
        Box(
            Modifier
                .fillMaxWidth(fraction)
                .height(trackHeight)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.70f)),
        )
        Box(
            Modifier
                .offset { androidx.compose.ui.unit.IntOffset((fraction * constraints.maxWidth - thumbPx / 2f).roundToInt(), 0) }
                .size(thumbSize)
                .graphicsLayer { alpha = thumbAlpha }
                .shadow((2f * scale).dp, CircleShape)
                .clip(CircleShape)
                .background(Color.White)
                .border((1f * scale).dp, Color.White.copy(alpha = 0.50f), CircleShape),
        )
    }
}
