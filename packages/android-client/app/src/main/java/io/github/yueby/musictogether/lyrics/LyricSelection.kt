package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

data class LyricQuality(
    val animated: Boolean,
    val confidence: Double,
    val textCoverage: Double,
    val validTimingCoverage: Double,
    val repeatedCoverage: Double,
    val structureCount: Int,
)

private data class TimedText(val time: Long, val text: String, val normalized: String)
private fun normalized(value: String) = value.lowercase().replace(Regex("""[^\p{L}\p{N}]+"""), "")
private fun valid(start: Long, end: Long) = start >= 0 && end > start

private fun lcs(left: String, right: String): Int {
    val row = IntArray(right.length + 1)
    left.forEach { character ->
        var diagonal = 0
        right.indices.forEach { index ->
            val previous = row[index + 1]
            row[index + 1] = if (character == right[index]) diagonal + 1 else max(row[index + 1], row[index])
            diagonal = previous
        }
    }
    return row.last()
}

private fun similarity(left: String, right: String): Double {
    if (left == right) return 1.0
    val shorter = min(left.length, right.length)
    val longer = max(left.length, right.length)
    if (shorter < 3) return 0.0
    val common = lcs(left, right)
    return if (common.toDouble() / shorter >= 0.88 && common.toDouble() / longer >= 0.42) 0.55 + common.toDouble() / longer * 0.4 else 0.0
}

private fun parseLrc(value: String): List<TimedText> {
    val regex = Regex("""\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?](.*)""")
    return value.lineSequence().mapNotNull { line ->
        val match = regex.find(line) ?: return@mapNotNull null
        val text = match.groupValues[4].trim()
        val normalized = normalized(text)
        if (normalized.isEmpty()) return@mapNotNull null
        val fraction = match.groupValues[3].padEnd(3, '0').take(3).toLongOrNull() ?: 0
        TimedText(((match.groupValues[1].toLong() * 60 + match.groupValues[2].toLong()) * 1000) + fraction, text, normalized)
    }.sortedBy(TimedText::time).toList()
}

fun evaluateLyricQuality(lines: List<LyricLine>, referenceLrc: String = ""): LyricQuality {
    val meaningful = lines.filter { normalized(it.text).isNotEmpty() }
    val characters = meaningful.sumOf { normalized(it.text).length }.coerceAtLeast(1)
    fun animated(line: LyricLine) = line.words.filter { valid(it.startTimeMs, it.endTimeMs) }.map { it.startTimeMs to it.endTimeMs }.distinct().size >= 2
    val animationCoverage = meaningful.filter(::animated).sumOf { normalized(it.text).length }.toDouble() / characters
    val validCoverage = meaningful.sumOf { line -> line.words.filter { valid(it.startTimeMs, it.endTimeMs) }.sumOf { normalized(it.text).length } }.toDouble() / characters
    val reference = parseLrc(referenceLrc).map(TimedText::normalized)
    val referenceText = reference.joinToString("")
    val textCoverage = if (referenceText.isEmpty()) if (meaningful.isEmpty()) 0.0 else 1.0 else lcs(meaningful.joinToString("") { normalized(it.text) }, referenceText).toDouble() / referenceText.length
    val repeated = reference.filter { it.length >= 4 }.groupingBy { it }.eachCount().filterValues { it >= 2 }
    val repeatedTotal = repeated.entries.sumOf { it.key.length * it.value }
    val repeatedAnimated = repeated.entries.sumOf { (text, count) -> text.length * min(count, meaningful.count { animated(it) && similarity(normalized(it.text), text) > 0 }) }
    val repeatedCoverage = if (repeatedTotal >= 20) repeatedAnimated.toDouble() / repeatedTotal else 1.0
    val animatedLineCount = meaningful.count(::animated)
    val requiredAnimatedLines = min(3, max(1, kotlin.math.ceil(meaningful.size * 0.1).toInt()))
    val isAnimated = animatedLineCount >= requiredAnimatedLines && animationCoverage >= 0.55 && validCoverage >= 0.85 && textCoverage >= 0.8 && repeatedCoverage >= 0.6
    return LyricQuality(isAnimated, animationCoverage * 0.4 + textCoverage * 0.25 + validCoverage * 0.2 + repeatedCoverage * 0.15, textCoverage, validCoverage, repeatedCoverage, lines.count { it.isDuet || it.isBackground })
}

fun preferLyricCandidate(current: List<LyricLine>, next: List<LyricLine>, referenceLrc: String = "", nextIsTtml: Boolean = false): Boolean {
    if (current.isEmpty()) return next.isNotEmpty()
    val currentQuality = evaluateLyricQuality(current, referenceLrc)
    val nextQuality = evaluateLyricQuality(next, referenceLrc)
    val currentStructure = currentQuality.structureCount > 0 && currentQuality.textCoverage >= 0.8 && currentQuality.validTimingCoverage >= 0.85
    val nextStructure = nextQuality.structureCount > 0 && nextQuality.textCoverage >= 0.8 && nextQuality.validTimingCoverage >= 0.85
    if (currentStructure != nextStructure) return nextStructure
    if (currentQuality.animated != nextQuality.animated) return nextQuality.animated
    return nextQuality.confidence > currentQuality.confidence + if (nextIsTtml) -0.01 else 0.03
}

fun needsLyricSupplement(lines: List<LyricLine>, referenceLrc: String = ""): Boolean {
    if (!evaluateLyricQuality(lines, referenceLrc).animated) return true
    val meaningful = lines.filter { !it.isBackground && normalized(it.text).isNotEmpty() }
    val text = meaningful.joinToString("") { it.text }
    val koreanOrJapanese = Regex("""[\p{IsHangul}\p{IsHiragana}\p{IsKatakana}]""").containsMatchIn(text)
    val foreign = koreanOrJapanese || Regex("[A-Za-z]").findAll(text).count() >= 24
    val translationCoverage = meaningful.count { it.translatedLyric.isNotBlank() }.toDouble() / meaningful.size.coerceAtLeast(1)
    val romanCoverage = meaningful.count { it.romanLyric.isNotBlank() }.toDouble() / meaningful.size.coerceAtLeast(1)
    return foreign && (translationCoverage < 0.6 || (koreanOrJapanese && romanCoverage < 0.6))
}

private fun pair(original: List<TimedText>, auxiliary: String): List<String> {
    val values = parseLrc(auxiliary)
    var cursor = 0
    return original.map { entry ->
        while (cursor < values.size && values[cursor].time < entry.time - 1500) cursor++
        var best = -1
        var distance = 1501L
        for (index in cursor until values.size) {
            if (values[index].time > entry.time + 1500) break
            val candidate = abs(values[index].time - entry.time)
            if (candidate < distance) { best = index; distance = candidate }
        }
        if (best < 0) "" else values[best].text.also { cursor = best + 1 }
    }
}

private fun align(lines: List<LyricLine>, original: List<TimedText>): IntArray {
    val targets = lines.mapIndexedNotNull { index, line -> normalized(line.text).takeIf { !line.isBackground && valid(line.startTimeMs, line.endTimeMs) && it.isNotEmpty() }?.let { Triple(index, line.startTimeMs, it) } }
    val offsets = targets.mapNotNull { target -> original.filter { it.normalized == target.third }.takeIf { it.size == 1 && targets.count { candidate -> candidate.third == target.third } == 1 }?.single()?.let { target.second - it.time }?.takeIf { abs(it) <= 6000 } }.sorted()
    val offset = if (offsets.size >= 3) offsets[offsets.size / 2] else 0L
    val width = original.size + 1
    val scores = FloatArray((targets.size + 1) * width)
    val decisions = ByteArray(scores.size)
    for (i in 1..targets.size) for (j in 1..original.size) {
        val cell = i * width + j
        val up = scores[(i - 1) * width + j]
        val left = scores[cell - 1]
        scores[cell] = max(up, left)
        decisions[cell] = if (up >= left) 1 else 2
        val match = similarity(targets[i - 1].third, original[j - 1].normalized)
        val distance = abs(targets[i - 1].second - original[j - 1].time - offset)
        val diagonal = scores[(i - 1) * width + j - 1] + match.toFloat() * 10 + 1 - distance.toFloat() / 6000
        if (match > 0 && distance <= 6000 && diagonal > scores[cell]) { scores[cell] = diagonal; decisions[cell] = 3 }
    }
    val result = IntArray(lines.size) { -1 }
    var i = targets.size
    var j = original.size
    while (i > 0 && j > 0) when (decisions[i * width + j].toInt()) {
        3 -> { result[targets[i - 1].first] = j - 1; i--; j-- }
        2 -> j--
        else -> i--
    }
    return result
}

private fun completeMapping(
    lines: List<LyricLine>,
    original: List<TimedText>,
    values: List<String>,
    mapping: IntArray,
): IntArray {
    val completed = mapping.copyOf()
    val matchedCount = completed.count { it >= 0 }
    if (matchedCount < min(8, ((original.size + 4) / 5).coerceAtLeast(1))) return completed
    val offsets = mutableListOf<Long>()
    completed.forEachIndexed { lineIndex, sourceIndex ->
        if (sourceIndex >= 0) offsets += lines[lineIndex].startTimeMs - original[sourceIndex].time
    }
    offsets.sort()
    val offset = offsets.getOrElse(offsets.size / 2) { 0L }
    val used = completed.filter { it >= 0 }.toMutableSet()
    original.indices.forEach { sourceIndex ->
        if (sourceIndex in used || values[sourceIndex].isEmpty()) return@forEach
        var previousTarget = -1
        for (lineIndex in completed.indices.reversed()) {
            if (completed[lineIndex] in 0 until sourceIndex) {
                previousTarget = lineIndex
                break
            }
        }
        val nextTarget = completed.indexOfFirst { it > sourceIndex }.let { if (it < 0) completed.size else it }
        var bestTarget = -1
        var bestDistance = 6_001L
        for (lineIndex in previousTarget + 1 until nextTarget) {
            val line = lines[lineIndex]
            if (completed[lineIndex] >= 0 || line.isBackground || !valid(line.startTimeMs, line.endTimeMs)) continue
            val distance = abs(line.startTimeMs - original[sourceIndex].time - offset)
            if (distance < bestDistance) {
                bestDistance = distance
                bestTarget = lineIndex
            }
        }
        if (bestTarget >= 0) {
            completed[bestTarget] = sourceIndex
            used += sourceIndex
        }
    }
    return completed
}

fun enrichLyricLines(lines: List<LyricLine>, sources: List<JSONObject>, structure: List<LyricLine> = emptyList()): List<LyricLine> {
    val result = lines.toMutableList()
    data class Source(val original: List<TimedText>, val translated: List<String>, val roman: List<String>, val mapping: IntArray)
    val prepared = sources.mapNotNull { source ->
        val original = parseLrc(source.optString("lyric"))
        original.takeIf { it.isNotEmpty() }?.let { Source(it, pair(it, source.optString("tlyric")), pair(it, source.optString("romalrc")), align(result, it)) }
    }
    listOf(false, true).forEach { roman ->
        val ranked = prepared.sortedByDescending { source -> source.mapping.count { index -> index >= 0 && (if (roman) source.roman else source.translated)[index].isNotEmpty() } }
        ranked.forEach { source -> completeMapping(result, source.original, if (roman) source.roman else source.translated, source.mapping).forEachIndexed { lineIndex, sourceIndex ->
            if (sourceIndex >= 0) {
                val value = (if (roman) source.roman else source.translated)[sourceIndex]
                val line = result[lineIndex]
                if (value.isNotEmpty() && (if (roman) line.romanLyric else line.translatedLyric).isBlank()) result[lineIndex] = if (roman) line.copy(romanLyric = value) else line.copy(translatedLyric = value)
            }
        } }
    }
    if (structure.isNotEmpty()) {
        val originals = structure.map { TimedText(it.startTimeMs, it.text, normalized(it.text)) }
        val mapping = align(result, originals)
        if (mapping.count { it >= 0 } >= min(3, (originals.size * 0.2).toInt().coerceAtLeast(1))) mapping.forEachIndexed { index, sourceIndex ->
            if (sourceIndex >= 0) {
                val source = structure[sourceIndex]
                val line = result[index]
                result[index] = line.copy(isDuet = line.isDuet || source.isDuet, isBackground = line.isBackground || (source.isBackground && index > 0 && !result[index - 1].isBackground))
            }
        }
    }
    return result
}
