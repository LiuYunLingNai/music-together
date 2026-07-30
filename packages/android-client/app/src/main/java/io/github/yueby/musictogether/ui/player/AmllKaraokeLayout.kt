package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import io.github.yueby.musictogether.lyrics.AmllEmphasisProfile
import io.github.yueby.musictogether.lyrics.AmllMeasuredChunk
import io.github.yueby.musictogether.lyrics.AmllWordChunk
import io.github.yueby.musictogether.lyrics.amllEmphasisProfile
import io.github.yueby.musictogether.lyrics.calculateAmllBalancedBreaks
import io.github.yueby.musictogether.lyrics.isAmllCjk
import io.github.yueby.musictogether.lyrics.shouldAmllEmphasize
import io.github.yueby.musictogether.lyrics.splitAmllGraphemes
import io.github.yueby.musictogether.model.LyricWord

private val AmllWordFloatEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

internal data class AmllFlowLine(
    val itemIndices: MutableList<Int> = mutableListOf(),
    var width: Int = 0,
    var height: Int = 0,
    var firstBaseline: Int = 0,
    var belowBaseline: Int = 0,
)

@Composable
internal fun AmllBalancedWordLayout(
    chunks: List<AmllWordChunk>,
    alignEnd: Boolean,
    verticalGapPx: Int,
    modifier: Modifier = Modifier,
    content: @Composable (Int, AmllWordChunk) -> Unit,
) {
    Layout(
        modifier = modifier,
        content = {
            chunks.forEachIndexed { index, chunk ->
                content(index, chunk)
            }
        },
    ) { measurables, constraints ->
        val placeables = measurables.map { measurable ->
            measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
        }
        val breaks = calculateAmllBalancedBreaks(
            children = chunks.mapIndexed { index, chunk ->
                AmllMeasuredChunk(
                    width = placeables[index].width.toDouble(),
                    text = chunk.text,
                    isSpace = chunk.text.isBlank(),
                )
            },
            containerWidth = constraints.maxWidth.toDouble(),
        ).toSet()
        val lines = mutableListOf(AmllFlowLine())

        fun append(index: Int) {
            val placeable = placeables[index]
            val line = lines.last()
            val firstBaseline = placeable[FirstBaseline].takeIf { it >= 0 }
                ?: placeable.height
            line.itemIndices += index
            line.width += placeable.width
            line.firstBaseline = maxOf(line.firstBaseline, firstBaseline)
            line.belowBaseline = maxOf(
                line.belowBaseline,
                placeable.height - firstBaseline,
            )
            line.height = line.firstBaseline + line.belowBaseline
        }

        chunks.indices.forEach { index ->
            if (index in breaks) {
                lines += AmllFlowLine()
            }
            append(index)
        }

        val contentHeight = lines.sumOf { it.height } +
            verticalGapPx * (lines.size - 1).coerceAtLeast(0)
        layout(
            width = constraints.maxWidth,
            height = contentHeight.coerceIn(constraints.minHeight, constraints.maxHeight),
        ) {
            var y = 0
            lines.forEach { line ->
                var x = if (alignEnd) constraints.maxWidth - line.width else 0
                line.itemIndices.forEach { index ->
                    val placeable = placeables[index]
                    val firstBaseline = placeable[FirstBaseline].takeIf { it >= 0 }
                        ?: placeable.height
                    placeable.placeRelative(
                        x = x,
                        y = y + amllBaselinePlacementOffset(
                            lineBaselinePx = line.firstBaseline,
                            itemBaselinePx = firstBaseline,
                        ),
                    )
                    x += placeable.width
                }
                y += line.height + verticalGapPx
            }
        }
    }
}

@Composable
internal fun AmllKaraokeChunk(
    chunk: AmllWordChunk,
    lastLineWord: String,
    positionMs: Float,
    effectReleaseProgress: Float,
    reserveRomanSpace: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    darkAlpha: Float,
    brightAlpha: Float,
    isBackground: Boolean,
    maskWordIndexOffset: Int,
    continuousMaskProgresses: List<Float>,
    onMaskWordSizeChanged: (Int, AmllMaskWordMeasurement) -> Unit,
) {
    val mergedWord = remember(chunk.words) {
        LyricWord(
            text = chunk.text,
            startTimeMs = chunk.startTimeMs,
            endTimeMs = chunk.endTimeMs,
        )
    }
    val emphasize = chunk.words.any(::shouldAmllEmphasize) ||
        (!isAmllCjk(chunk.text) && shouldAmllEmphasize(mergedWord))
    val profile = remember(chunk, lastLineWord) {
        amllEmphasisProfile(chunk, lastLineWord)
    }
    val graphemesByWord = remember(chunk.words) {
        chunk.words.map { splitAmllGraphemes(it.text.trim()) }
    }
    val rubyGlyphCount = chunk.words.sumOf { word ->
        word.ruby.sumOf { ruby -> splitAmllGraphemes(ruby.text).size }
    }
    val glyphCount = (
        if (rubyGlyphCount > 0) {
            rubyGlyphCount
        } else {
            graphemesByWord.sumOf(List<String>::size)
        }
        ).coerceAtLeast(1)
    val glyphOffsets = remember(graphemesByWord) {
        var offset = 0
        graphemesByWord.map { glyphs ->
            offset.also { offset += glyphs.size }
        }
    }

    Row {
        chunk.words.forEachIndexed { index, word ->
            AmllKaraokeWord(
                word = word,
                graphemes = graphemesByWord[index],
                positionMs = positionMs,
                effectReleaseProgress = effectReleaseProgress,
                reserveRomanSpace = reserveRomanSpace,
                reserveRubySpace = reserveRubySpace,
                fontSize = fontSize,
                fontWeight = fontWeight,
                darkAlpha = darkAlpha,
                brightAlpha = brightAlpha,
                emphasize = emphasize,
                isBackground = isBackground,
                chunkStartTimeMs = chunk.startTimeMs,
                profile = profile,
                glyphIndexOffset = glyphOffsets[index],
                glyphCount = glyphCount,
                continuousHighlightProgress =
                    continuousMaskProgresses.getOrNull(maskWordIndexOffset + index),
                onMainTextSizeChanged = { size, horizontalHeadroomPx ->
                    onMaskWordSizeChanged(
                        maskWordIndexOffset + index,
                        AmllMaskWordMeasurement(size, horizontalHeadroomPx),
                    )
                },
                modifier = Modifier.alignByBaseline(),
            )
        }
    }
}
