package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord

/** QQ word timestamps are absolute milliseconds, unlike KRC's line-relative offsets. */
internal fun parseQrcLyrics(text: String): List<LyricLine> {
    val linePattern = Regex("\\[(\\d+),(\\d+)](.*)")
    val wordPattern = Regex("(.*?)\\((\\d+),(\\d+)\\)")
    return text.lineSequence().mapNotNull { raw ->
        val line = linePattern.find(raw) ?: return@mapNotNull null
        val start = line.groupValues[1].toLongOrNull() ?: return@mapNotNull null
        val duration = line.groupValues[2].toLongOrNull() ?: return@mapNotNull null
        if (start !in 0..86_400_000 || duration !in 1..86_400_000) return@mapNotNull null
        val words = wordPattern.findAll(line.groupValues[3]).mapNotNull { token ->
            val wordStart = token.groupValues[2].toLongOrNull() ?: return@mapNotNull null
            val wordDuration = token.groupValues[3].toLongOrNull() ?: return@mapNotNull null
            if (wordStart !in 0..86_400_000 || wordDuration !in 0..86_400_000 || token.groupValues[1].isEmpty()) {
                return@mapNotNull null
            }
            LyricWord(token.groupValues[1], wordStart, wordStart + wordDuration)
        }.toList()
        if (words.isEmpty()) null else LyricLine(words, startTimeMs = start, endTimeMs = start + duration)
    }.sortedBy { it.startTimeMs }.toList()
}
