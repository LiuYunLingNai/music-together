package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.math.sqrt

internal data class AmllLyricGroup(
    val main: LyricLine,
    val background: LyricLine? = null,
) {
    val startTimeMs: Long get() = main.startTimeMs
    val endTimeMs: Long get() = main.endTimeMs
}

internal data class AmllInterlude(
    val startTimeMs: Long,
    val endTimeMs: Long,
    val anchorGroupIndex: Int,
    val isNextDuet: Boolean,
)

internal data class AmllWordChunk(
    val words: List<LyricWord>,
) {
    val text: String get() = words.joinToString("") { it.text }
    val startTimeMs: Long get() = words.minOf { it.startTimeMs }
    val endTimeMs: Long get() = words.maxOf { it.endTimeMs }
}

internal data class AmllEmphasisProfile(
    val durationMs: Long,
    val amount: Float,
    val blur: Float,
)

internal data class AmllMeasuredChunk(
    val width: Double,
    val text: String,
    val isSpace: Boolean,
)

internal data class AmllMaskBoundaries(
    val brightEndFraction: Float,
    val fadeEndFraction: Float,
)

internal data class AmllLineSpringParameters(
    val stiffness: Float,
    val damping: Float,
) {
    val dampingRatio: Float
        get() = damping / (2f * sqrt(stiffness))
}

/**
 * Kotlin port of AMLL core's default optimizeLyricLines pipeline.
 *
 * The input remains untouched. The returned groups use the same main-line +
 * optional following background-line structure as AMLL's LyricLineGroup.
 */
internal fun prepareAmllLyricGroups(input: List<LyricLine>): List<AmllLyricGroup> {
    if (input.isEmpty()) return emptyList()

    var lines = input
        .map(::normalizeLineSpaces)

    lines = resetLineTimestamps(lines)
    lines = convertExcessiveBackgroundLines(lines)
    lines = syncMainAndBackgroundLines(lines)
    lines = cleanUnintentionalOverlaps(lines)
    lines = tryAdvanceStartTime(lines)

    val groups = mutableListOf<AmllLyricGroup>()
    lines.forEach { line ->
        if (line.isBackground && groups.isNotEmpty() && groups.last().background == null) {
            groups[groups.lastIndex] = groups.last().copy(background = line)
        } else {
            groups += AmllLyricGroup(main = line.copy(isBackground = false))
        }
    }
    return groups
}

private fun normalizeLineSpaces(line: LyricLine): LyricLine = line.copy(
    words = line.words.map { word ->
        word.copy(text = word.text.replace(Regex("""\s+"""), " "))
    },
)

private fun resetLineTimestamps(lines: List<LyricLine>): List<LyricLine> = lines.map { line ->
    when {
        line.words.size == 1 &&
            line.words.single().startTimeMs == 0L &&
            line.words.single().endTimeMs == 0L &&
            (line.startTimeMs != 0L || line.endTimeMs != 0L) -> {
            line.copy(
                words = listOf(
                    line.words.single().copy(
                        startTimeMs = line.startTimeMs,
                        endTimeMs = line.endTimeMs,
                    ),
                ),
            )
        }

        line.words.isNotEmpty() -> line.copy(
            startTimeMs = line.words.first().startTimeMs,
            endTimeMs = line.words.last().endTimeMs,
        )

        else -> line
    }
}

private fun convertExcessiveBackgroundLines(lines: List<LyricLine>): List<LyricLine> {
    var consecutiveBackgroundCount = 0
    return lines.map { line ->
        if (line.isBackground) {
            consecutiveBackgroundCount += 1
            if (consecutiveBackgroundCount > 1) line.copy(isBackground = false) else line
        } else {
            consecutiveBackgroundCount = 0
            line
        }
    }
}

private fun syncMainAndBackgroundLines(lines: List<LyricLine>): List<LyricLine> {
    val result = lines.toMutableList()
    for (index in result.lastIndex downTo 0) {
        val main = result[index]
        if (main.isBackground) continue
        val background = result.getOrNull(index + 1)?.takeIf { it.isBackground } ?: continue
        val timedWords = (main.words + background.words).filter { it.text.isNotBlank() }
        if (timedWords.isEmpty()) continue

        val finalStart = minOf(
            timedWords.minOf { it.startTimeMs },
            main.startTimeMs,
            background.startTimeMs,
        )
        val finalEnd = maxOf(
            timedWords.maxOf { it.endTimeMs },
            main.endTimeMs,
            background.endTimeMs,
        )
        result[index] = main.copy(startTimeMs = finalStart, endTimeMs = finalEnd)
        result[index + 1] = background.copy(startTimeMs = finalStart, endTimeMs = finalEnd)
    }
    return result
}

private fun cleanUnintentionalOverlaps(lines: List<LyricLine>): List<LyricLine> {
    val result = lines.toMutableList()
    for (index in 0 until result.lastIndex) {
        val line = result[index]
        if (line.isBackground) continue

        var nextMainIndex = index + 1
        while (nextMainIndex < result.size && result[nextMainIndex].isBackground) {
            nextMainIndex += 1
        }
        val nextLine = result.getOrNull(nextMainIndex) ?: continue
        val overlap = line.endTimeMs - nextLine.startTimeMs
        if (overlap <= 0L) continue

        val nextDuration = nextLine.endTimeMs - nextLine.startTimeMs
        val intentional = overlap > 100L && overlap > nextDuration * 0.1
        if (!intentional) {
            result[index] = line.copy(endTimeMs = nextLine.startTimeMs)
            if (result.getOrNull(index + 1)?.isBackground == true) {
                result[index + 1] = result[index + 1].copy(endTimeMs = nextLine.startTimeMs)
            }
        }
    }
    return result
}

private fun tryAdvanceStartTime(lines: List<LyricLine>): List<LyricLine> {
    val result = lines.toMutableList()
    var previousLineStart = 0L
    var previousLineEnd = 0L
    var previousGroupStart = 0L
    var previousGroupEnd = 0L
    var hasPreviousLine = false

    for (index in result.indices) {
        val line = result[index]
        if (line.isBackground) continue

        val originalStart = line.startTimeMs
        val originalEnd = line.endTimeMs
        val originallyHadGap = hasPreviousLine && originalStart >= previousLineEnd
        val advanceAmount = when {
            !hasPreviousLine || originallyHadGap -> 600L
            else -> 400L
        }
        val safeBoundary = when {
            !hasPreviousLine -> 0L
            originallyHadGap -> previousGroupEnd
            else -> previousLineStart +
                ((previousLineEnd - previousLineStart) * 0.3).roundToLong()
        }
        val advancedStart = maxOf(safeBoundary, originalStart - advanceAmount)
        result[index] = line.copy(startTimeMs = minOf(originalStart, advancedStart))

        if (result.getOrNull(index + 1)?.isBackground == true) {
            result[index + 1] = result[index + 1].copy(
                startTimeMs = result[index].startTimeMs,
            )
        }

        if (hasPreviousLine && originalStart < previousGroupEnd && originalEnd > previousGroupStart) {
            previousGroupStart = minOf(previousGroupStart, originalStart)
            previousGroupEnd = maxOf(previousGroupEnd, originalEnd)
        } else {
            previousGroupStart = originalStart
            previousGroupEnd = originalEnd
        }
        previousLineStart = originalStart
        previousLineEnd = originalEnd
        hasPreviousLine = true
    }
    return result
}

internal fun findAmllInterlude(
    groups: List<AmllLyricGroup>,
    currentTimeMs: Long,
    currentGroupIndex: Int,
): AmllInterlude? {
    val adjustedTime = currentTimeMs + 20L

    fun checkGap(anchorIndex: Int): AmllInterlude? {
        if (anchorIndex < -1 || anchorIndex >= groups.lastIndex) return null
        val previous = groups.getOrNull(anchorIndex)
        val next = groups.getOrNull(anchorIndex + 1) ?: return null
        val gapStart = previous?.endTimeMs ?: 0L
        val gapEnd = maxOf(gapStart, next.startTimeMs - 250L)
        if (gapEnd - gapStart < 4_000L) return null
        if (adjustedTime <= gapStart || adjustedTime >= gapEnd) return null
        return AmllInterlude(
            startTimeMs = gapStart,
            endTimeMs = gapEnd,
            anchorGroupIndex = anchorIndex,
            isNextDuet = next.main.isDuet,
        )
    }

    return checkGap(currentGroupIndex - 1) ?:
        checkGap(currentGroupIndex) ?:
        checkGap(currentGroupIndex + 1)
}

/**
 * Matches AMLL's adaptive lyric-position spring.
 *
 * Rapid consecutive lines use a stiffer spring so the focus does not lag
 * behind the audio. Seeking and interludes use the steadier fixed profile.
 */
internal fun amllLineSpringParameters(
    currentStartTimeMs: Long,
    previousStartTimeMs: Long?,
    stabilize: Boolean,
): AmllLineSpringParameters {
    if (stabilize || previousStartTimeMs == null) {
        return AmllLineSpringParameters(stiffness = 90f, damping = 15f)
    }

    val interval = (currentStartTimeMs - previousStartTimeMs).coerceIn(100L, 800L)
    var ratio = 1.0 - (interval - 100L).toDouble() / 700.0
    ratio = ratio.pow(0.2)
    val stiffness = (170.0 + ratio * 50.0).toFloat()
    return AmllLineSpringParameters(
        stiffness = stiffness,
        damping = sqrt(stiffness) * 2.2f,
    )
}

internal fun chunkAmllWords(line: LyricLine): List<AmllWordChunk> {
    val atoms = mutableListOf<LyricWord>()
    val partRegex = Regex("""\s+|\S+""")

    line.words.forEach { source ->
        if (source.ruby.isNotEmpty()) {
            atoms += source
            return@forEach
        }
        val parts = partRegex.findAll(source.text).map { it.value }.toList()
        val totalUnits = parts
            .filterNot(String::isBlank)
            .sumOf { splitAmllGraphemes(it).size }
            .coerceAtLeast(1)
        val timePerUnit =
            (source.endTimeMs - source.startTimeMs).coerceAtLeast(0L).toDouble() / totalUnits
        var currentOffset = 0

        parts.forEach { part ->
            val partStart = source.startTimeMs + (currentOffset * timePerUnit).roundToLong()
            if (part.isBlank()) {
                atoms += source.copy(
                    text = part,
                    startTimeMs = partStart,
                    endTimeMs = partStart,
                    romanText = "",
                )
                return@forEach
            }

            val graphemes = splitAmllGraphemes(part)
            if (isAmllCjk(part) && graphemes.size > 1 && source.romanText.isBlank()) {
                graphemes.forEach { grapheme ->
                    val start = source.startTimeMs + (currentOffset * timePerUnit).roundToLong()
                    atoms += source.copy(
                        text = grapheme,
                        startTimeMs = start,
                        endTimeMs = source.startTimeMs +
                            ((currentOffset + 1) * timePerUnit).roundToLong(),
                        romanText = "",
                    )
                    currentOffset += 1
                }
            } else {
                val unitCount = graphemes.size.coerceAtLeast(1)
                atoms += source.copy(
                    text = part,
                    startTimeMs = partStart,
                    endTimeMs = source.startTimeMs +
                        ((currentOffset + unitCount) * timePerUnit).roundToLong(),
                )
                currentOffset += unitCount
            }
        }
    }

    val chunks = mutableListOf<AmllWordChunk>()
    var mergeable = mutableListOf<LyricWord>()
    fun flushMergeable() {
        if (mergeable.isNotEmpty()) {
            chunks += AmllWordChunk(mergeable)
            mergeable = mutableListOf()
        }
    }

    atoms.forEach { atom ->
        val canMerge =
            atom.text.isNotBlank() &&
                atom.ruby.isEmpty() &&
                !isAmllCjk(atom.text)
        if (canMerge) {
            mergeable += atom
        } else {
            flushMergeable()
            chunks += AmllWordChunk(listOf(atom))
        }
    }
    flushMergeable()
    return chunks
}

internal fun splitAmllGraphemes(value: String): List<String> {
    if (value.isEmpty()) return emptyList()
    val iterator = BreakIterator.getCharacterInstance(Locale.ROOT)
    iterator.setText(value)
    return buildList {
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            add(value.substring(start, end))
            start = end
            end = iterator.next()
        }
    }
}

internal fun isAmllCjk(value: String): Boolean {
    val content = value.filterNot(Char::isWhitespace)
    if (content.isEmpty()) return false
    return content.codePoints().toArray().all { codePoint ->
        Character.UnicodeScript.of(codePoint) in setOf(
            Character.UnicodeScript.HAN,
            Character.UnicodeScript.HIRAGANA,
            Character.UnicodeScript.KATAKANA,
            Character.UnicodeScript.HANGUL,
        )
    }
}

/**
 * Port of AMLL core's calcBalancedBreaks dynamic-programming line breaker.
 *
 * Java's word BreakIterator supplies the word-like CJK boundaries that the
 * browser implementation obtains from Intl.Segmenter.
 */
internal fun calculateAmllBalancedBreaks(
    children: List<AmllMeasuredChunk>,
    containerWidth: Double,
): List<Int> {
    val count = children.size
    if (count == 0 || containerWidth <= 0.0) return emptyList()

    val fullText = children.joinToString("") { it.text }
    val cjkBoundaries = mutableSetOf<Int>()
    val wordIterator = BreakIterator.getWordInstance(Locale.ROOT)
    wordIterator.setText(fullText)
    var segmentStart = wordIterator.first()
    var segmentEnd = wordIterator.next()
    while (segmentEnd != BreakIterator.DONE) {
        val segment = fullText.substring(segmentStart, segmentEnd)
        val isWordLike = segment.codePoints().anyMatch(Character::isLetterOrDigit)
        if (segmentStart > 0 && isWordLike && segment.codePoints().anyMatch { codePoint ->
                isAmllCjk(String(Character.toChars(codePoint)))
            }
        ) {
            cjkBoundaries += segmentStart
        }
        segmentStart = segmentEnd
        segmentEnd = wordIterator.next()
    }

    val charOffsets = IntArray(count + 1)
    val prefixWidths = DoubleArray(count + 1)
    children.forEachIndexed { index, child ->
        charOffsets[index + 1] = charOffsets[index] + child.text.length
        prefixWidths[index + 1] = prefixWidths[index] + child.width
    }
    if (prefixWidths[count] <= containerWidth) return emptyList()

    val costs = DoubleArray(count + 1) { Double.POSITIVE_INFINITY }
    val nextBreaks = IntArray(count + 1) { -1 }
    costs[count] = 0.0
    val cjkPenalty = (containerWidth * 0.15).let { it * it }
    val normalPenalty = (containerWidth * 0.5).let { it * it }
    val punctuation = Regex("""[,.;:!?，。；：！？、）】》」』’”)\[\]}>~…]$""")

    for (start in count - 1 downTo 0) {
        for (end in start + 1..count) {
            val lineWidth = prefixWidths[end] - prefixWidths[start]
            val lineCost = when {
                lineWidth <= containerWidth ->
                    (containerWidth - lineWidth).let { it * it }

                end == start + 1 ->
                    (lineWidth - containerWidth).let { it * it * 1_000.0 }

                else -> continue
            }
            val breakPenalty = if (end >= count) {
                0.0
            } else {
                val previous = children[end - 1]
                when {
                    punctuation.containsMatchIn(previous.text) ->
                        -(containerWidth * 0.6).let { it * it }

                    previous.isSpace ->
                        -(containerWidth * 0.4).let { it * it }

                    charOffsets[end] in cjkBoundaries -> cjkPenalty
                    else -> normalPenalty
                }
            }
            val totalCost = lineCost + breakPenalty + costs[end]
            if (totalCost < costs[start]) {
                costs[start] = totalCost
                nextBreaks[start] = end
            }
        }
    }

    return buildList {
        var current = 0
        while (current < count) {
            val next = nextBreaks[current]
            if (next <= current) break
            current = next
            if (current in 1 until count) add(current)
        }
    }
}

/**
 * AMLL's mask image has a fade width equal to half the rendered word height.
 * Its image travels by wordWidth + fadeWidth over the word duration.
 */
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
    val start = word.startTimeMs.toFloat()
    val end = word.endTimeMs.toFloat()
    if (positionMs <= start) return 0f
    if (positionMs >= end) return 1f
    return ((positionMs - start) / (end - start).coerceAtLeast(1f)).coerceIn(0f, 1f)
}
