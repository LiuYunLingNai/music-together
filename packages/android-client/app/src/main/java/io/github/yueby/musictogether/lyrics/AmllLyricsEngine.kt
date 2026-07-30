package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import kotlin.math.roundToLong

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
