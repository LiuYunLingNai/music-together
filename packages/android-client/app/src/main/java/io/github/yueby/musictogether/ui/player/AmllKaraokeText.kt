package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllWordChunk
import io.github.yueby.musictogether.lyrics.amllContinuousWordMaskProgresses
import io.github.yueby.musictogether.lyrics.chunkAmllWords
import io.github.yueby.musictogether.model.LyricLine

private val AmllWordFloatEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

internal fun amllBaselineTransformOrigin(
    firstBaselinePx: Int,
    heightPx: Int,
): Float {
    if (heightPx <= 0 || firstBaselinePx < 0) return 1f
    return firstBaselinePx.toFloat().div(heightPx).coerceIn(0f, 1f)
}

internal fun amllBaselinePlacementOffset(
    lineBaselinePx: Int,
    itemBaselinePx: Int,
): Int = lineBaselinePx - itemBaselinePx

internal fun amllCollapsedEffectWidth(
    measuredWidthPx: Int,
    horizontalHeadroomPx: Int,
): Int = (measuredWidthPx - horizontalHeadroomPx.coerceAtLeast(0) * 2)
    .coerceAtLeast(0)

internal data class AmllMaskWordMeasurement(
    val size: IntSize,
    val horizontalHeadroomPx: Int,
)

private class AmllTextGeometryReporter {
    var localBounds: List<Rect> = emptyList()
    var coordinates: LayoutCoordinates? = null
    var onChanged: ((AmllPrimaryTextGeometry) -> Unit)? = null

    fun publish() {
        val currentCoordinates = coordinates?.takeIf(LayoutCoordinates::isAttached) ?: return
        if (localBounds.isEmpty()) return
        val visualLines = localBounds.map { bounds ->
            val topLeft = currentCoordinates.localToRoot(bounds.topLeft)
            val bottomRight = currentCoordinates.localToRoot(bounds.bottomRight)
            Rect(
                left = minOf(topLeft.x, bottomRight.x),
                top = minOf(topLeft.y, bottomRight.y),
                right = maxOf(topLeft.x, bottomRight.x),
                bottom = maxOf(topLeft.y, bottomRight.y),
            )
        }
        onChanged?.invoke(AmllPrimaryTextGeometry.fromVisualLines(visualLines))
    }
}

private fun TextLayoutResult.amllVisualLineBounds(): List<Rect> =
    (0 until lineCount).map { lineIndex ->
        Rect(
            left = getLineLeft(lineIndex),
            top = getLineTop(lineIndex),
            right = getLineRight(lineIndex),
            bottom = getLineBottom(lineIndex),
        )
    }

internal fun hasAmllTimedWords(line: LyricLine): Boolean =
    line.words.any { word -> word.endTimeMs > word.startTimeMs }

@Composable
internal fun AmllWordLine(
    line: LyricLine,
    positionMs: Float,
    active: Boolean,
    effectReleaseProgress: Float = if (active) 1f else 0f,
    onPrimaryTextGeometryChanged: ((AmllPrimaryTextGeometry) -> Unit)? = null,
    wordAnimationEnabled: Boolean,
    readingMode: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    isBackground: Boolean = false,
) {
    val hasDynamicTiming = wordAnimationEnabled && hasAmllTimedWords(line)
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val inactiveAlpha = amllInactiveMainLineAlpha(readingMode)
    val targetDarkAlpha = if (active) 0.4f else inactiveAlpha
    val targetBrightAlpha = if (active) 1f else inactiveAlpha
    val darkAlpha = rememberAmllMaskAlpha(targetDarkAlpha).value
    val brightAlpha = rememberAmllMaskAlpha(targetBrightAlpha).value
    val baseAlpha = darkAlpha
    val geometryReporter = remember { AmllTextGeometryReporter() }
    geometryReporter.onChanged = onPrimaryTextGeometryChanged
    SideEffect { geometryReporter.publish() }

    if (!hasDynamicTiming) {
        Text(
            text = line.text,
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    onPrimaryTextGeometryChanged?.let {
                        Modifier.onGloballyPositioned { coordinates ->
                            geometryReporter.coordinates = coordinates
                            geometryReporter.publish()
                        }
                    } ?: Modifier,
                ),
            textAlign = textAlign,
            color = Color.White.copy(alpha = if (active) brightAlpha else baseAlpha),
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
            onTextLayout = { result ->
                if (onPrimaryTextGeometryChanged != null) {
                    geometryReporter.localBounds = result.amllVisualLineBounds()
                    geometryReporter.publish()
                }
            },
        )
        return
    }

    val chunks = remember(line.words) { chunkAmllWords(line) }
    val maskWords = remember(chunks) {
        chunks
            .filterNot { it.text.isBlank() }
            .flatMap(AmllWordChunk::words)
    }
    val chunkMaskWordOffsets = remember(chunks) {
        var wordOffset = 0
        chunks.map { chunk ->
            if (chunk.text.isBlank()) {
                -1
            } else {
                wordOffset.also { wordOffset += chunk.words.size }
            }
        }
    }
    val maskWordMeasurements = remember(chunks) {
        mutableStateMapOf<Int, AmllMaskWordMeasurement>()
    }
    val continuousMaskProgresses = maskWords.indices
        .mapNotNull(maskWordMeasurements::get)
        .takeIf { it.size == maskWords.size }
        ?.let { measurements ->
            amllContinuousWordMaskProgresses(
                words = maskWords,
                widthsPx = measurements.map { it.size.width.toFloat() },
                heightsPx = measurements.map { it.size.height.toFloat() },
                positionMs = positionMs,
                horizontalPaddingsPx = measurements.map {
                    it.horizontalHeadroomPx.toFloat()
                },
            )
        }
        .orEmpty()
    val hasRomanWords = line.words.any { it.romanText.isNotBlank() }
    val hasRubyWords = line.words.any { it.ruby.isNotEmpty() }
    val density = LocalDensity.current
    val wrappedLineGap = with(density) { (fontSize * 0.12f).sp.roundToPx() }
    val emphasisHeadroom = with(density) { (fontSize * 0.16f).sp.toDp() }

    AmllBalancedWordLayout(
        chunks = chunks,
        alignEnd = line.isDuet,
        verticalGapPx = wrappedLineGap,
        onVisualLineBoundsInRootChanged = onPrimaryTextGeometryChanged?.let { onChanged ->
            { visualLines ->
                if (visualLines.isNotEmpty()) {
                    onChanged(AmllPrimaryTextGeometry.fromVisualLines(visualLines))
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = emphasisHeadroom),
    ) { chunkIndex, chunk ->
        if (chunk.text.isBlank()) {
            Text(
                // Compose may measure a trailing regular space as zero width.
                // AMLL inserts a DOM text node here, so use non-breaking spaces
                // to retain the same visible advance without joining words.
                text = chunk.text.map { character ->
                    if (character.isWhitespace()) '\u00A0' else character
                }.joinToString(""),
                fontSize = fontSize.sp,
                lineHeight = (fontSize * 1.25f).sp,
                maxLines = 1,
            )
        } else {
            AmllKaraokeChunk(
                chunk = chunk,
                lastLineWord = line.words.lastOrNull()?.text.orEmpty(),
                positionMs = positionMs,
                effectReleaseProgress = effectReleaseProgress,
                reserveRomanSpace = hasRomanWords,
                reserveRubySpace = hasRubyWords,
                fontSize = fontSize,
                fontWeight = fontWeight,
                darkAlpha = baseAlpha,
                brightAlpha = brightAlpha,
                isBackground = isBackground,
                maskWordIndexOffset = chunkMaskWordOffsets[chunkIndex],
                continuousMaskProgresses = continuousMaskProgresses,
                onMaskWordSizeChanged = { wordIndex, measurement ->
                    if (maskWordMeasurements[wordIndex] != measurement) {
                        maskWordMeasurements[wordIndex] = measurement
                    }
                },
            )
        }
    }
}
