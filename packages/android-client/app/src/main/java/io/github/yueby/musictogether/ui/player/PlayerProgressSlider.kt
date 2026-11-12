package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.tanh

private const val SliderMaxHeight = 20f
private const val SliderRestInset = 6f
private const val SliderMaxBounce = 12f
private val SliderBounceSpring = spring<Float>(dampingRatio = 0.35f, stiffness = 300f)
private val SliderCollapseSpring = spring<Float>(dampingRatio = 0.42f, stiffness = 200f)

/**
 * Web / AMLL `BouncingSlider`: an 8px thumbless rail that swells to 20px while held, rubber-bands
 * when dragged past either end, and extrapolates between player clock updates on the frame clock.
 */
@Composable
internal fun PlayerProgressSlider(
    value: Float,
    maximumValue: Float,
    seeking: Boolean,
    playing: Boolean,
    enabled: Boolean,
    scale: Float,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val latestChange by rememberUpdatedState(onValueChange)
    val latestFinished by rememberUpdatedState(onValueChangeFinished)
    val range = maximumValue.coerceAtLeast(0.0001f)
    val scope = rememberCoroutineScope()
    val inset = remember { Animatable(SliderRestInset) }
    val bounce = remember { Animatable(0f) }
    val local = remember { mutableFloatStateOf(value) }
    LaunchedEffect(value) { local.floatValue = value }
    LaunchedEffect(playing, seeking, range) {
        if (!playing || seeking) return@LaunchedEffect
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) {
                    local.floatValue = (local.floatValue + (now - last) / 1_000_000_000f).coerceAtMost(range)
                }
                last = now
            }
        }
    }

    Box(
        modifier = modifier
            .height((24f * scale).dp)
            .pointerInput(enabled, range) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    fun update(x: Float) {
                        val rel = x / size.width
                        val target = when {
                            rel < 0f -> tanh(rel * 2f) * SliderMaxBounce
                            rel > 1f -> tanh((rel - 1f) * 2f) * SliderMaxBounce
                            else -> 0f
                        }
                        scope.launch { bounce.animateTo(target, SliderBounceSpring) }
                        latestChange(rel.coerceIn(0f, 1f) * range)
                    }
                    scope.launch { inset.animateTo(0f, tween(280, easing = EaseOut)) }
                    update(down.position.x)
                    drag(down.id) { change ->
                        change.consume()
                        update(change.position.x)
                    }
                    scope.launch { inset.animateTo(SliderRestInset, SliderCollapseSpring) }
                    scope.launch { bounce.animateTo(0f, SliderBounceSpring) }
                    latestFinished()
                }
            },
    ) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationX = bounce.value * scale * density
                    alpha = if (enabled) 1f else 0.5f
                },
        ) {
            val barHeight = (SliderMaxHeight - 2f * inset.value).coerceAtLeast(1f) * scale * density
            val top = (size.height - barHeight) / 2f
            val fraction = ((if (seeking) value else local.floatValue) / range).coerceIn(0f, 1f)
            val rail = Path().apply {
                addRoundRect(RoundRect(0f, top, size.width, top + barHeight, CornerRadius(barHeight / 2f)))
            }
            clipPath(rail) {
                drawRect(Color.White.copy(alpha = 0.15f), Offset(0f, top), Size(size.width, barHeight))
                drawRect(Color.White.copy(alpha = 0.40f), Offset(0f, top), Size(size.width * fraction, barHeight))
            }
        }
    }
}
