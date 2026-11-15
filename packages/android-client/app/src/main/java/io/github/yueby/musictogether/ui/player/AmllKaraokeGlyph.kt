package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllEmphasisProfile
import io.github.yueby.musictogether.lyrics.amllEmphasisEasing
import io.github.yueby.musictogether.lyrics.amllEmphasisProfile
import io.github.yueby.musictogether.lyrics.amllReleasedEffectProgress
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import kotlin.math.roundToInt
import kotlin.math.PI
import kotlin.math.sin

@Composable
internal fun AmllAnimatedWordLayer(
    text: String,
    graphemes: List<String>,
    positionMs: () -> Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    effectReleaseProgress: () -> Float,
    modifier: Modifier = Modifier,
) {
    if (emphasize) {
        AmllAnimatedGlyphRow(
            graphemes = graphemes,
            positionMs = positionMs,
            fontSize = fontSize,
            fontWeight = fontWeight,
            color = color,
            emphasize = true,
            chunkStartTimeMs = chunkStartTimeMs,
            profile = profile,
            glyphIndexOffset = glyphIndexOffset,
            glyphCount = glyphCount,
            drawGlow = drawGlow,
            isBackground = isBackground,
            effectReleaseProgress = effectReleaseProgress,
            modifier = modifier,
        )
    } else {
        Text(
            text = text,
            modifier = modifier,
            color = color,
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.2f).sp,
            fontWeight = fontWeight,
            maxLines = 1,
        )
    }
}

@Composable
internal fun AmllAnimatedGlyphRow(
    graphemes: List<String>,
    positionMs: () -> Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    effectReleaseProgress: () -> Float,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier) {
        graphemes.forEachIndexed { index, grapheme ->
            AmllAnimatedCharacter(
                grapheme = grapheme,
                positionMs = positionMs,
                fontSize = fontSize,
                fontWeight = fontWeight,
                color = color,
                emphasize = emphasize,
                chunkStartTimeMs = chunkStartTimeMs,
                profile = profile,
                glyphIndex = glyphIndexOffset + index,
                glyphCount = glyphCount,
                drawGlow = drawGlow,
                isBackground = isBackground,
                effectReleaseProgress = effectReleaseProgress,
                modifier = Modifier.alignByBaseline(),
            )
        }
    }
}

@Composable
internal fun AmllAnimatedCharacter(
    grapheme: String,
    positionMs: () -> Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndex: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    effectReleaseProgress: () -> Float,
    modifier: Modifier = Modifier,
) {
    val expensiveEffectsEnabled = LocalAmllExpensiveEffectsEnabled.current
    val staggerMs = profile.durationMs.toFloat() / 2.5f / glyphCount
    val entryTimeMs = chunkStartTimeMs + staggerMs * glyphIndex
    val durationMs = profile.durationMs.toFloat()
    val emphasisAt: (Float) -> Float = { at ->
        if (emphasize) {
            amllReleasedEffectProgress(
                effectProgress = amllEmphasisEasing(((at - entryTimeMs) / durationMs).coerceIn(0f, 1f)),
                releaseProgress = effectReleaseProgress(),
            )
        } else {
            0f
        }
    }
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val glyphEffectHeadroom = with(density) { fontSizePx.toDp() }
    val glyphEffectHeadroomPx = with(density) { glyphEffectHeadroom.roundToPx() }
    val centerOffset = glyphCount / 2f - glyphIndex
    // The glow is a text shadow, which only composition can change: step it like the 32 AMLL keyframes.
    val glowOn = drawGlow && expensiveEffectsEnabled && emphasize
    val glowStep by remember(glowOn, entryTimeMs, durationMs, positionMs) {
        derivedStateOf { if (glowOn) (emphasisAt(positionMs()) * 32f).roundToInt() else 0 }
    }
    val glowLevel = (glowStep / 32f * profile.blur).coerceIn(0f, 0.8f).div(0.6f).coerceAtMost(1f)
    val glowRadius = if (glowStep > 0) fontSizePx * minOf(0.3f, profile.blur * 0.3f) else 0f

    Layout(
        modifier = modifier,
        content = {
            Text(
                text = grapheme,
                modifier = Modifier.padding(horizontal = glyphEffectHeadroom),
                color = color,
                fontSize = fontSize.sp,
                lineHeight = (fontSize * 1.2f).sp,
                fontWeight = fontWeight,
                maxLines = 1,
                style = TextStyle(
                    shadow = Shadow(
                        color = Color.White.copy(alpha = glowLevel),
                        blurRadius = glowRadius,
                    ),
                ),
            )
        },
    ) { measurables, constraints ->
        val expandedConstraints = constraints.copy(
            minWidth = 0,
            minHeight = 0,
            maxWidth = if (constraints.hasBoundedWidth) {
                (constraints.maxWidth + glyphEffectHeadroomPx * 2)
                    .coerceAtMost(Constraints.Infinity)
            } else {
                Constraints.Infinity
            },
        )
        val placeable = measurables.single().measure(expandedConstraints)
        val firstBaseline = placeable[FirstBaseline]
        val contentWidth = amllCollapsedEffectWidth(
            measuredWidthPx = placeable.width,
            horizontalHeadroomPx = glyphEffectHeadroomPx,
        )
        layout(
            width = contentWidth.coerceIn(constraints.minWidth, constraints.maxWidth),
            height = placeable.height.coerceIn(constraints.minHeight, constraints.maxHeight),
            alignmentLines = mapOf(FirstBaseline to firstBaseline),
        ) {
            placeable.placeWithLayer(-glyphEffectHeadroomPx, 0) {
                val at = positionMs()
                val emphasis = emphasisAt(at)
                // AMLL `generateFloatKeyframes`: a sine lift over 1.4x the duration plus a rise that stays.
                val floatProgress =
                    if (emphasize) ((at - entryTimeMs) / (durationMs * 1.4f)).coerceIn(0f, 1f) else 0f
                val floatScale = if (isBackground) 2f else 1f
                val floatLift =
                    (sin(floatProgress * PI).toFloat() * 0.05f + floatProgress * 0.05f) * floatScale
                val scale = 1f + emphasis * 0.1f * profile.amount
                scaleX = scale
                scaleY = scale
                translationX = -emphasis * 0.03f * profile.amount * centerOffset * fontSizePx
                translationY = -(emphasis * 0.025f * profile.amount + floatLift * effectReleaseProgress()) * fontSizePx
                transformOrigin = TransformOrigin(
                    pivotFractionX = 0.5f,
                    pivotFractionY = amllBaselineTransformOrigin(
                        firstBaselinePx = firstBaseline,
                        heightPx = placeable.height,
                    ),
                )
            }
        }
    }
}

@Composable
internal fun rememberAmllMaskAlpha(target: Float): State<Float> {
    var previousTarget = remember { target }
    val durationMs =
        if (target > previousTarget) AmllMaskAttackDurationMs else AmllMaskReleaseDurationMs
    SideEffect { previousTarget = target }
    return animateFloatAsState(
        targetValue = target,
        animationSpec = tween(
            durationMillis = durationMs,
            easing = AmllMaskAlphaEasing,
        ),
        label = "amllMaskAlpha",
    )
}

internal const val AmllMaskAttackDurationMs = 300
internal const val AmllMaskReleaseDurationMs = 450
internal val AmllMaskAlphaEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)
