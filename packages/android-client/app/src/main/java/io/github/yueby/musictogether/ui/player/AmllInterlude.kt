package io.github.yueby.musictogether.ui.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllInterlude
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.pow
import kotlin.math.sin

internal const val AmllInterludeDotSizeScale = 0.62f
internal const val AmllInterludeLineGapScale = 0.4f

internal fun amllInterludeReservedHeight(fontSizePx: Float): Float =
    fontSizePx * (AmllInterludeDotSizeScale + AmllInterludeLineGapScale)

internal data class AmllInterludeVisualState(
    val scale: Float,
    val dotAlphas: List<Float>,
)

internal fun amllInterludeVisualState(
    interlude: AmllInterlude,
    positionMs: Float,
): AmllInterludeVisualState {
    val duration = (interlude.endTimeMs - interlude.startTimeMs).coerceAtLeast(1L).toFloat()
    val elapsed = (positionMs - interlude.startTimeMs).coerceIn(0f, duration)
    val remaining = (duration - elapsed).coerceAtLeast(0f)
    val dotTimeline = (duration - 750f).coerceAtLeast(1f)
    val fadeInProgress = ((elapsed - 500f) / 500f).coerceIn(0f, 1f)
    val fadeOutProgress = (remaining / 375f).coerceIn(0f, 1f)
    val globalAlpha = minOf(fadeInProgress, fadeOutProgress)
    val breatheDuration = duration / ceil(duration / 1_500f).coerceAtLeast(1f)
    val breathe = 1f + sin(1.5f * PI.toFloat() - (elapsed / breatheDuration) * 2f) / 20f
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
    return AmllInterludeVisualState(scale = scale, dotAlphas = dotAlphas)
}

@Composable
internal fun AmllInterludeOverlay(
    interlude: AmllInterlude,
    positionMs: State<Float>,
    anchorBoundsInRoot: Rect?,
    fontSize: Float,
    horizontalPaddingPx: Float,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val dotSize = with(density) { (fontSize * AmllInterludeDotSizeScale).sp.toDp() }
    val dotGap = with(density) { (fontSize * 0.25f).sp.toDp() }
    val verticalGapPx = with(density) { (fontSize * AmllInterludeLineGapScale).sp.toPx() }
    val dotSizePx = with(density) { dotSize.toPx() }
    val dotGapPx = with(density) { dotGap.toPx() }
    val canvasWidth = dotSize * 3 + dotGap * 2
    var containerBoundsInRoot by remember { mutableStateOf(Rect.Zero) }
    val anchor = anchorBoundsInRoot ?: return
    val x = if (interlude.isNextDuet) {
        containerBoundsInRoot.width - horizontalPaddingPx -
            with(density) { canvasWidth.toPx() }
    } else {
        horizontalPaddingPx
    }
    val y = anchor.top - containerBoundsInRoot.top - verticalGapPx - dotSizePx

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .onGloballyPositioned { coordinates ->
                containerBoundsInRoot = coordinates.boundsInRoot()
            },
    ) {
        val visual = amllInterludeVisualState(interlude, positionMs.value)
        val rowWidthPx = dotSizePx * 3f + dotGapPx * 2f
        val centerX = x + rowWidthPx / 2f
        val centerY = y + dotSizePx / 2f
        repeat(3) { index ->
            val baseX = x + dotSizePx / 2f + index * (dotSizePx + dotGapPx)
            val scaledX = centerX + (baseX - centerX) * visual.scale
            drawCircle(
                color = Color.White.copy(alpha = visual.dotAlphas[index]),
                radius = dotSizePx / 2f * visual.scale,
                center = androidx.compose.ui.geometry.Offset(scaledX, centerY),
            )
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
