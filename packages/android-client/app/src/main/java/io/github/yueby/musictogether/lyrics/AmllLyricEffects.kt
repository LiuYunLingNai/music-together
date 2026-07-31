package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricWord
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.math.sqrt

internal fun amllMaskBoundaries(
    progress: Float,
    width: Float,
    height: Float,
): AmllMaskBoundaries {
    val safeWidth = width.coerceAtLeast(0.0001f)
    val fadeWidth = height.coerceAtLeast(0f) * 0.5f
    val fadeEnd = progress.coerceIn(0f, 1f) * (safeWidth + fadeWidth)
    return AmllMaskBoundaries(
        brightEndFraction = (fadeEnd - fadeWidth) / safeWidth,
        fadeEndFraction = fadeEnd / safeWidth,
    )
}

internal fun amllMaskAlphaAt(
    progress: Float,
    xFraction: Float,
    width: Float,
    height: Float,
): Float {
    val boundaries = amllMaskBoundaries(progress, width, height)
    val fadeSpan = boundaries.fadeEndFraction - boundaries.brightEndFraction
    return when {
        xFraction <= boundaries.brightEndFraction -> 1f
        xFraction >= boundaries.fadeEndFraction -> 0f
        fadeSpan <= 0f -> 0f
        else -> (
            (boundaries.fadeEndFraction - xFraction) / fadeSpan
            ).coerceIn(0f, 1f)
    }
}

internal fun shouldAmllEmphasize(word: LyricWord): Boolean {
    val text = word.text.trim()
    val duration = word.endTimeMs - word.startTimeMs
    if (text.isEmpty() || duration < 1_000L) return false
    return isAmllCjk(text) || text.length in 2..7
}

internal fun amllEmphasisEasing(progress: Float): Float {
    val value = progress.coerceIn(0f, 1f)
    return if (value < 0.5f) {
        AmllEasing.emphasisIn(value / 0.5f)
    } else {
        1f - AmllEasing.emphasisOut((value - 0.5f) / 0.5f)
    }
}

internal fun amllReleasedEffectProgress(
    effectProgress: Float,
    releaseProgress: Float,
): Float = effectProgress.coerceIn(0f, 1f) * releaseProgress.coerceIn(0f, 1f)

private object AmllEasing {
    private val emphasisIn = CubicBezier(0.2, 0.4, 0.58, 1.0)
    private val emphasisOut = CubicBezier(0.3, 0.0, 0.58, 1.0)

    fun emphasisIn(value: Float): Float = emphasisIn.transform(value)

    fun emphasisOut(value: Float): Float = emphasisOut.transform(value)
}

/**
 * CSS cubic-bezier inversion matching bezier-easing/Compose's easing contract.
 */
private class CubicBezier(
    x1: Double,
    y1: Double,
    x2: Double,
    y2: Double,
) {
    private val cx = 3.0 * x1
    private val bx = 3.0 * (x2 - x1) - cx
    private val ax = 1.0 - cx - bx
    private val cy = 3.0 * y1
    private val by = 3.0 * (y2 - y1) - cy
    private val ay = 1.0 - cy - by

    fun transform(input: Float): Float {
        val x = input.coerceIn(0f, 1f).toDouble()
        var parameter = x
        repeat(8) {
            val error = sampleX(parameter) - x
            if (kotlin.math.abs(error) < 1e-7) return@repeat
            val slope = sampleSlopeX(parameter)
            if (kotlin.math.abs(slope) < 1e-7) return@repeat
            parameter -= error / slope
        }
        var low = 0.0
        var high = 1.0
        repeat(20) {
            val sample = sampleX(parameter)
            if (sample < x) low = parameter else high = parameter
            parameter = (low + high) / 2.0
        }
        return sampleY(parameter).toFloat().coerceIn(0f, 1f)
    }

    private fun sampleX(value: Double): Double = ((ax * value + bx) * value + cx) * value

    private fun sampleY(value: Double): Double = ((ay * value + by) * value + cy) * value

    private fun sampleSlopeX(value: Double): Double =
        (3.0 * ax * value + 2.0 * bx) * value + cx
}

internal fun amllEmphasisProfile(
    chunk: AmllWordChunk,
    lastLineWord: String,
): AmllEmphasisProfile {
    var duration = (chunk.endTimeMs - chunk.startTimeMs).coerceAtLeast(1_000L)
    val normalizedAmount = duration / 2_000f
    var amount = (
        if (normalizedAmount > 1f) sqrt(normalizedAmount) else normalizedAmount.pow(3)
        ) * 0.6f
    val normalizedBlur = duration / 3_000f
    var blur = (
        if (normalizedBlur > 1f) sqrt(normalizedBlur) else normalizedBlur.pow(3)
        ) * 0.5f

    if (lastLineWord.isNotBlank() && chunk.text.contains(lastLineWord)) {
        amount *= 1.6f
        blur *= 1.5f
        duration = (duration * 1.2f).roundToLong()
    }

    return AmllEmphasisProfile(
        durationMs = duration,
        amount = amount.coerceAtMost(1.2f),
        blur = blur.coerceAtMost(0.8f),
    )
}

internal fun amllWordProgress(word: LyricWord, positionMs: Float): Float {
    fun progressBetween(startTimeMs: Long, endTimeMs: Long): Float {
        val start = startTimeMs.toFloat()
        val end = endTimeMs.toFloat()
        if (positionMs <= start) return 0f
        if (positionMs >= end) return 1f
        return ((positionMs - start) / (end - start).coerceAtLeast(1f))
            .coerceIn(0f, 1f)
    }

    val rubySegments = word.ruby.filter { it.text.isNotBlank() }
    if (rubySegments.isEmpty()) {
        return progressBetween(word.startTimeMs, word.endTimeMs)
    }

    val wordEndTimeMs = maxOf(word.startTimeMs, word.endTimeMs)
    val weightedSegments = rubySegments.mapNotNull { ruby ->
        val unitCount = splitAmllGraphemes(ruby.text).size
        if (unitCount == 0) return@mapNotNull null
        val startTimeMs = ruby.startTimeMs.coerceIn(word.startTimeMs, wordEndTimeMs)
        val endTimeMs = ruby.endTimeMs.coerceIn(startTimeMs, wordEndTimeMs)
        Triple(unitCount, startTimeMs, endTimeMs)
    }
    val totalUnits = weightedSegments.sumOf { it.first }
    if (totalUnits == 0) {
        return progressBetween(word.startTimeMs, word.endTimeMs)
    }

    val completedUnits = weightedSegments.sumOf { (unitCount, startTimeMs, endTimeMs) ->
        unitCount * progressBetween(startTimeMs, endTimeMs).toDouble()
    }
    return (completedUnits / totalUnits).toFloat().coerceIn(0f, 1f)
}

/**
 * Projects AMLL's line-wide mask travel back into each rendered word.
 *
 * The fade front is continuous across adjacent words and remains stationary
 * during timestamp gaps. Each returned value can still be rendered with the
 * existing per-word gradient, while preserving the spill from the previous
 * word instead of restarting at zero.
 */
internal fun amllContinuousWordMaskProgresses(
    words: List<LyricWord>,
    widthsPx: List<Float>,
    heightsPx: List<Float>,
    positionMs: Float,
    horizontalPaddingsPx: List<Float> = List(words.size) { 0f },
): List<Float> {
    if (
        words.isEmpty() ||
        words.size != widthsPx.size ||
        words.size != heightsPx.size ||
        words.size != horizontalPaddingsPx.size ||
        widthsPx.any { it <= 0f } ||
        heightsPx.any { it <= 0f } ||
        horizontalPaddingsPx.any { it < 0f }
    ) {
        return emptyList()
    }

    val wordProgresses = FloatArray(words.size)
    var timedWidthTravelPx = 0f
    words.indices.forEach { wordIndex ->
        val progress = amllWordProgress(words[wordIndex], positionMs)
        wordProgresses[wordIndex] = progress
        timedWidthTravelPx += widthsPx[wordIndex] * progress
    }
    val edgeFadeTravel =
        wordProgresses.first() * 1.5f + wordProgresses.last() * 0.5f

    var widthBeforeWord = 0f
    return List(words.size) { targetIndex ->
        val fadeWidthPx = heightsPx[targetIndex] * 0.5f
        val horizontalPaddingPx = horizontalPaddingsPx[targetIndex]
        val travelledPx =
            timedWidthTravelPx + fadeWidthPx * edgeFadeTravel
        val localFadeEndPx =
            travelledPx -
                widthBeforeWord +
                horizontalPaddingPx -
                fadeWidthPx
        val localTravelPx =
            widthsPx[targetIndex] + horizontalPaddingPx * 2f + fadeWidthPx
        (localFadeEndPx / localTravelPx).coerceIn(0f, 1f).also {
            widthBeforeWord += widthsPx[targetIndex]
        }
    }
}
