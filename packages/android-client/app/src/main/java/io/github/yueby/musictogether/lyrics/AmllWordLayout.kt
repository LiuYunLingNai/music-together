package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.roundToLong

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
