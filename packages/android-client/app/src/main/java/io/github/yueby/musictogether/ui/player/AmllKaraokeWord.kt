package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllEmphasisProfile
import io.github.yueby.musictogether.lyrics.amllEmphasisProfile
import io.github.yueby.musictogether.lyrics.amllMaskAlphaAt
import io.github.yueby.musictogether.lyrics.amllMaskBoundaries
import io.github.yueby.musictogether.lyrics.amllWordProgress
import io.github.yueby.musictogether.model.LyricWord

private val AmllWordFloatEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

@Composable
internal fun AmllKaraokeWord(
    word: LyricWord,
    graphemes: List<String>,
    positionMs: Float,
    effectReleaseProgress: Float,
    reserveRomanSpace: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    darkAlpha: Float,
    brightAlpha: Float,
    gradientEnabled: Boolean,
    emphasize: Boolean,
    isBackground: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    continuousHighlightProgress: Float?,
    onMainTextSizeChanged: (IntSize, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val wordFloatDuration = (word.endTimeMs - word.startTimeMs).coerceAtLeast(1_000L)
    val wordFloatProgress =
        ((positionMs - word.startTimeMs) / wordFloatDuration).coerceIn(0f, 1f)
    val wordFloat = AmllWordFloatEasing.transform(wordFloatProgress)
    val wordFloatAmount = if (isBackground) 0.1f else 0.05f
    val highlightProgress =
        continuousHighlightProgress ?: amllWordProgress(word, positionMs)
    val effectHeadroom =
        with(density) { fontSize.sp.toDp() } * if (emphasize) 1f else 0f
    val effectHeadroomPx = with(density) { effectHeadroom.roundToPx() }

    Layout(
        modifier = modifier
            .graphicsLayer {
                translationY =
                    -wordFloat * wordFloatAmount * fontSizePx * effectReleaseProgress
            }
            .onSizeChanged { size ->
                onMainTextSizeChanged(size, effectHeadroomPx)
            },
        content = {
            AmllKaraokeWordLayer(
                word = word,
                graphemes = graphemes,
                positionMs = positionMs,
                reserveRomanSpace = reserveRomanSpace,
                reserveRubySpace = reserveRubySpace,
                fontSize = fontSize,
                fontWeight = fontWeight,
                color = Color.White.copy(alpha = darkAlpha),
                emphasize = emphasize,
                isBackground = isBackground,
                chunkStartTimeMs = chunkStartTimeMs,
                profile = profile,
                glyphIndexOffset = glyphIndexOffset,
                glyphCount = glyphCount,
                drawGlow = false,
                effectReleaseProgress = effectReleaseProgress,
                modifier = Modifier.padding(horizontal = effectHeadroom),
            )
            if (gradientEnabled) {
                AmllKaraokeWordLayer(
                    word = word,
                    graphemes = graphemes,
                    positionMs = positionMs,
                    reserveRomanSpace = reserveRomanSpace,
                    reserveRubySpace = reserveRubySpace,
                    fontSize = fontSize,
                    fontWeight = fontWeight,
                    color = Color.White.copy(
                        alpha = (brightAlpha - darkAlpha).coerceAtLeast(0f),
                    ),
                    emphasize = emphasize,
                    isBackground = isBackground,
                    chunkStartTimeMs = chunkStartTimeMs,
                    profile = profile,
                    glyphIndexOffset = glyphIndexOffset,
                    glyphCount = glyphCount,
                    drawGlow = true,
                    effectReleaseProgress = effectReleaseProgress,
                    modifier = Modifier
                        .graphicsLayer {
                            compositingStrategy = CompositingStrategy.Offscreen
                        }
                        .drawWithContent {
                            when {
                                highlightProgress <= 0f -> Unit
                                highlightProgress >= 1f -> drawContent()
                                else -> {
                                    drawContent()
                                    val canvasWidth = size.width
                                    val canvasHeight = size.height
                                    val boundaries = amllMaskBoundaries(
                                        progress = highlightProgress,
                                        width = canvasWidth,
                                        height = canvasHeight,
                                    )
                                    val stops = buildList {
                                        add(
                                            0f to Color.Black.copy(
                                                alpha = amllMaskAlphaAt(
                                                    progress = highlightProgress,
                                                    xFraction = 0f,
                                                    width = canvasWidth,
                                                    height = canvasHeight,
                                                ),
                                            ),
                                        )
                                        if (boundaries.brightEndFraction in 0f..1f) {
                                            add(boundaries.brightEndFraction to Color.Black)
                                        }
                                        if (boundaries.fadeEndFraction in 0f..1f) {
                                            add(boundaries.fadeEndFraction to Color.Transparent)
                                        }
                                        add(
                                            1f to Color.Black.copy(
                                                alpha = amllMaskAlphaAt(
                                                    progress = highlightProgress,
                                                    xFraction = 1f,
                                                    width = canvasWidth,
                                                    height = canvasHeight,
                                                ),
                                            ),
                                        )
                                    }
                                    drawRect(
                                        brush = Brush.horizontalGradient(
                                            *stops.toTypedArray(),
                                        ),
                                        blendMode = BlendMode.DstIn,
                                    )
                                }
                            }
                        }
                        .padding(horizontal = effectHeadroom),
                )
            }
        },
    ) { measurables, constraints ->
        val expandedConstraints = constraints
            .copy(
                minWidth = 0,
                minHeight = 0,
                maxWidth = if (constraints.hasBoundedWidth) {
                    (constraints.maxWidth + effectHeadroomPx * 2)
                        .coerceAtMost(Constraints.Infinity)
                } else {
                    Constraints.Infinity
                },
            )
        val placeables = measurables.map { measurable ->
            measurable.measure(expandedConstraints)
        }
        val measuredWidth = placeables.maxOfOrNull { it.width } ?: 0
        val measuredHeight = placeables.maxOfOrNull { it.height } ?: 0
        val contentWidth = amllCollapsedEffectWidth(
            measuredWidthPx = measuredWidth,
            horizontalHeadroomPx = effectHeadroomPx,
        )
        val firstBaseline = placeables
            .firstOrNull()
            ?.get(FirstBaseline)
            ?.takeIf { it >= 0 }
        layout(
            width = contentWidth.coerceIn(constraints.minWidth, constraints.maxWidth),
            height = measuredHeight.coerceIn(constraints.minHeight, constraints.maxHeight),
            alignmentLines = firstBaseline?.let {
                mapOf<AlignmentLine, Int>(FirstBaseline to it)
            }.orEmpty(),
        ) {
            placeables.forEach { placeable ->
                placeable.placeRelative(x = -effectHeadroomPx, y = 0)
            }
        }
    }
}

@Composable
internal fun AmllKaraokeWordLayer(
    word: LyricWord,
    graphemes: List<String>,
    positionMs: Float,
    reserveRomanSpace: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    isBackground: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    effectReleaseProgress: Float,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (reserveRubySpace) {
            Row(verticalAlignment = Alignment.Bottom) {
                if (word.ruby.isEmpty()) {
                    Text(
                        text = " ",
                        color = Color.Transparent,
                        fontSize = (fontSize * 0.5f).sp,
                        lineHeight = (fontSize * 0.5f).sp,
                        maxLines = 1,
                    )
                } else {
                    word.ruby.forEach { ruby ->
                        Text(
                            text = ruby.text,
                            color = color,
                            fontSize = (fontSize * 0.5f).sp,
                            lineHeight = (fontSize * 0.5f).sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        AmllAnimatedWordLayer(
            text = word.text.trim(),
            graphemes = graphemes,
            positionMs = positionMs,
            fontSize = fontSize,
            fontWeight = fontWeight,
            color = color,
            emphasize = emphasize,
            chunkStartTimeMs = chunkStartTimeMs,
            profile = profile,
            glyphIndexOffset = glyphIndexOffset,
            glyphCount = glyphCount,
            drawGlow = drawGlow,
            isBackground = isBackground,
            effectReleaseProgress = effectReleaseProgress,
        )

        if (reserveRomanSpace) {
            Text(
                text = word.romanText.ifBlank { " " },
                color = if (word.romanText.isBlank()) Color.Transparent else color,
                fontSize = (fontSize * 0.5f).sp,
                lineHeight = (fontSize * 0.5f).sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}
