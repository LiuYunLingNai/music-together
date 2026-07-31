package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllInterlude
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.pow
import kotlin.math.sin

internal const val AmllInterludeTransitionDurationMs = 250L

@Composable
internal fun AmllInterludeSlot(
    interlude: AmllInterlude,
    positionMs: State<Float>,
    active: Boolean,
    fontSize: Float,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = active,
        modifier = modifier,
        enter = fadeIn(tween(AmllInterludeTransitionDurationMs.toInt())) +
            expandVertically(
                animationSpec = tween(AmllInterludeTransitionDurationMs.toInt()),
                expandFrom = Alignment.Top,
                clip = false,
            ),
        exit = fadeOut(tween(AmllInterludeTransitionDurationMs.toInt())) +
            shrinkVertically(
                animationSpec = tween(AmllInterludeTransitionDurationMs.toInt()),
                shrinkTowards = Alignment.Top,
                clip = false,
            ),
    ) {
        AmllInterludeDots(
            interlude = interlude,
            positionMs = positionMs,
            fontSize = fontSize,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun AmllInterludeDots(
    interlude: AmllInterlude,
    positionMs: State<Float>,
    fontSize: Float,
    modifier: Modifier = Modifier,
) {
    val currentPositionMs = positionMs.value
    val duration = (interlude.endTimeMs - interlude.startTimeMs).coerceAtLeast(1L).toFloat()
    val elapsed = (currentPositionMs - interlude.startTimeMs).coerceIn(0f, duration)
    val remaining = (duration - elapsed).coerceAtLeast(0f)
    val dotTimeline = (duration - 750f).coerceAtLeast(1f)
    val fadeInProgress = ((elapsed - 500f) / 500f).coerceIn(0f, 1f)
    val fadeOutProgress = (remaining / 375f).coerceIn(0f, 1f)
    val globalAlpha = minOf(fadeInProgress, fadeOutProgress)
    val breatheDuration = duration / ceil(duration / 1_500f).coerceAtLeast(1f)
    val breathe =
        1f + sin(1.5f * PI.toFloat() - (elapsed / breatheDuration) * 2f) / 20f
    val enterScale = if (elapsed < 2_000f) {
        1f - 2f.pow(-10f * (elapsed / 2_000f).coerceIn(0f, 1f))
    } else {
        1f
    }
    val exitScale = if (remaining < 750f) {
        1f - amllEaseInOutBack(
            ((750f - remaining) / 750f / 2f).coerceIn(0f, 0.5f),
        )
    } else {
        1f
    }
    val scale = (breathe * enterScale * exitScale * 0.7f).coerceAtLeast(0f)
    val dotAlphas = List(3) { index ->
        val offset = dotTimeline / 3f * index
        (((elapsed - offset) * 3f / dotTimeline) * 0.75f)
            .coerceIn(0.25f, 1f) * globalAlpha
    }
    val density = LocalDensity.current
    val dotSize = with(density) { (fontSize * 0.62f).sp.toDp() }
    val dotGap = with(density) { (fontSize * 0.25f).sp.toDp() }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(dotSize),
        contentAlignment =
            if (interlude.isNextDuet) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier
                .widthIn(min = dotSize * 3 + dotGap * 2)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                },
            horizontalArrangement = Arrangement.spacedBy(dotGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(3) { index ->
                Box(
                    modifier = Modifier
                        .size(dotSize)
                        .graphicsLayer { shape = CircleShape }
                        .drawWithContent {
                            drawCircle(Color.White.copy(alpha = dotAlphas[index]))
                        },
                )
            }
        }
    }
}

private fun amllEaseInOutBack(value: Float): Float {
    val x = value.coerceIn(0f, 1f)
    val c1 = 1.70158f
    val c2 = c1 * 1.525f
    return if (x < 0.5f) {
        ((2f * x).pow(2) * ((c2 + 1f) * 2f * x - c2)) / 2f
    } else {
        ((2f * x - 2f).pow(2) * ((c2 + 1f) * (2f * x - 2f) + c2) + 2f) / 2f
    }
}
