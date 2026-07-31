package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
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
import kotlin.math.PI
import kotlin.math.sin

private val AmllWordFloatEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

@Composable
internal fun AmllAnimatedWordLayer(
    text: String,
    graphemes: List<String>,
    positionMs: Float,
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
    effectReleaseProgress: Float,
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
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
            maxLines = 1,
        )
    }
}

@Composable
internal fun AmllAnimatedGlyphRow(
    graphemes: List<String>,
    positionMs: Float,
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
    effectReleaseProgress: Float,
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
    positionMs: Float,
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
    effectReleaseProgress: Float,
    modifier: Modifier = Modifier,
) {
    val expensiveEffectsEnabled = LocalAmllExpensiveEffectsEnabled.current
    val staggerMs = profile.durationMs.toFloat() / 2.5f / glyphCount
    val entryTimeMs = chunkStartTimeMs + staggerMs * glyphIndex
    val emphasisProgress =
        ((positionMs - entryTimeMs) / profile.durationMs).coerceIn(0f, 1f)
    val emphasis = if (emphasize) amllEmphasisEasing(emphasisProgress) else 0f
    val releasedEmphasis = amllReleasedEffectProgress(
        effectProgress = emphasis,
        releaseProgress = effectReleaseProgress,
    )
    val floatStartMs = entryTimeMs - 400f
    val floatProgress =
        ((positionMs - floatStartMs) / (profile.durationMs * 1.4f)).coerceIn(0f, 1f)
    val floatLift = if (emphasize) {
        sin(floatProgress * PI).toFloat() * if (isBackground) 2f else 1f
    } else {
        0f
    }
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val glyphEffectHeadroom = with(density) { fontSizePx.toDp() }
    val glyphEffectHeadroomPx = with(density) { glyphEffectHeadroom.roundToPx() }
    val centerOffset = glyphCount / 2f - glyphIndex
    val glowLevel = (releasedEmphasis * profile.blur).coerceIn(0f, 0.8f)
    val glowRadius =
        fontSizePx * minOf(0.3f, profile.blur * 0.3f) * releasedEmphasis

    val scale = 1f + releasedEmphasis * 0.1f * profile.amount
    val translationX =
        -releasedEmphasis * 0.03f * profile.amount * centerOffset * fontSizePx
    val translationY =
        -(
            releasedEmphasis * 0.025f * profile.amount +
                floatLift * 0.05f * effectReleaseProgress
            ) * fontSizePx

    Layout(
        modifier = modifier,
        content = {
            Text(
                text = grapheme,
                modifier = Modifier.padding(horizontal = glyphEffectHeadroom),
                color = color,
                fontSize = fontSize.sp,
                lineHeight = (fontSize * 1.25f).sp,
                fontWeight = fontWeight,
                maxLines = 1,
                style = TextStyle(
                    shadow = Shadow(
                        color = Color.White.copy(
                            alpha =
                                if (drawGlow && expensiveEffectsEnabled) {
                                    glowLevel
                                } else {
                                    0f
                                },
                        ),
                        blurRadius =
                            if (drawGlow && expensiveEffectsEnabled) {
                                glowRadius
                            } else {
                                0f
                            },
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
                scaleX = scale
                scaleY = scale
                this.translationX = translationX
                this.translationY = translationY
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
