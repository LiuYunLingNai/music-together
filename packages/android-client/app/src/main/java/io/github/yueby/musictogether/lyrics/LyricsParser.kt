package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.abs

object LyricsParser {
    private const val TTM_NS = "http://www.w3.org/ns/ttml#metadata"

    fun parseServerResponse(data: JSONObject): Pair<List<LyricLine>, String> {
        val translation = data.optString("tlyric")
        val roman = data.optString("romalrc")
        val wordByWord = data.optJSONArray("wordByWord")?.let(::parseWordByWord).orEmpty()
        if (wordByWord.isNotEmpty()) {
            return mergeAuxiliary(wordByWord, translation, roman) to "wordByWord"
        }
        val yrc = parseYrc(data.optString("yrc"))
        if (yrc.isNotEmpty()) {
            return mergeAuxiliary(yrc, translation, roman) to "yrc"
        }
        return mergeLrc(data.optString("lyric"), translation, roman) to "lrc"
    }

    fun parseTtml(xml: String): List<LyricLine> {
        if (!xml.contains("<tt")) return emptyList()
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            runCatching { setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
            runCatching { setFeature("http://xml.org/sax/features/external-general-entities", false) }
            runCatching { setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
        }
        val document = factory.newDocumentBuilder().parse(InputSource(StringReader(xml)))
        val paragraphs = document.getElementsByTagNameNS("*", "p")
        var primaryAgent: String? = null
        val result = mutableListOf<LyricLine>()
        repeat(paragraphs.length) { index ->
            val paragraph = paragraphs.item(index) as? Element ?: return@repeat
            val agent = attribute(paragraph, TTM_NS, "agent")
            if (primaryAgent == null && agent.isNotBlank()) primaryAgent = agent
            val start = parseTime(attribute(paragraph, null, "begin"))
            val end = parseTime(attribute(paragraph, null, "end"))
            val duet = primaryAgent != null && agent.isNotBlank() && agent != primaryAgent
            val mainWords = mutableListOf<LyricWord>()
            var translation = ""
            var roman = ""

            val children = paragraph.childNodes
            repeat(children.length) { childIndex ->
                when (val child = children.item(childIndex)) {
                    is Element -> {
                        if ((child.localName ?: child.tagName.substringAfter(':')) != "span") return@repeat
                        val role = attribute(child, TTM_NS, "role")
                        when (role) {
                            "x-translation" -> translation = child.textContent.trim()
                            "x-roman" -> roman = child.textContent.trim()
                            "x-bg" -> parseWordContainer(child, start, end).takeIf { it.isNotEmpty() }?.let { words ->
                                result += LyricLine(
                                    words = words,
                                    startTimeMs = words.first().startTimeMs,
                                    endTimeMs = words.last().endTimeMs,
                                    isBackground = true,
                                    isDuet = duet,
                                )
                            }
                            else -> {
                                val wordStart = parseTime(attribute(child, null, "begin")).takeIf { it > 0 } ?: start
                                val wordEnd = parseTime(attribute(child, null, "end")).takeIf { it > 0 } ?: end
                                val text = child.textContent
                                if (text.isNotEmpty()) mainWords += LyricWord(text, wordStart, wordEnd)
                            }
                        }
                    }
                    else -> if (child.nodeType == Node.TEXT_NODE && mainWords.isNotEmpty()) {
                        val whitespace = child.nodeValue
                        if (whitespace.isNotEmpty() && whitespace.all(Char::isWhitespace) && '\n' !in whitespace && '\r' !in whitespace) {
                            val last = mainWords.removeAt(mainWords.lastIndex)
                            mainWords += last.copy(text = last.text + whitespace)
                        }
                    }
                }
            }
            if (mainWords.isEmpty()) {
                val text = paragraph.textContent.trim()
                if (text.isNotEmpty()) mainWords += LyricWord(text, start, end)
            }
            if (mainWords.isNotEmpty()) {
                result += LyricLine(
                    words = mainWords,
                    translatedLyric = translation,
                    romanLyric = roman,
                    startTimeMs = start.takeIf { it > 0 } ?: mainWords.first().startTimeMs,
                    endTimeMs = end.takeIf { it > 0 } ?: mainWords.last().endTimeMs,
                    isDuet = duet,
                )
            }
        }
        return result.sortedWith(compareBy<LyricLine> { it.startTimeMs }.thenBy { it.isBackground })
    }

    private fun parseWordContainer(element: Element, fallbackStart: Long, fallbackEnd: Long): List<LyricWord> {
        val words = mutableListOf<LyricWord>()
        val spans = element.getElementsByTagNameNS("*", "span")
        repeat(spans.length) { index ->
            val span = spans.item(index) as? Element ?: return@repeat
            if (span === element) return@repeat
            val text = span.textContent
            if (text.isEmpty()) return@repeat
            words += LyricWord(
                text = text,
                startTimeMs = parseTime(attribute(span, null, "begin")).takeIf { it > 0 } ?: fallbackStart,
                endTimeMs = parseTime(attribute(span, null, "end")).takeIf { it > 0 } ?: fallbackEnd,
            )
        }
        return words
    }

    private fun parseWordByWord(array: JSONArray): List<LyricLine> = List(array.length()) { index ->
        val line = array.getJSONObject(index)
        val wordsJson = line.optJSONArray("words") ?: JSONArray()
        LyricLine(
            words = List(wordsJson.length()) { wordIndex ->
                val word = wordsJson.getJSONObject(wordIndex)
                LyricWord(
                    text = word.optString("word"),
                    startTimeMs = word.optLong("startTime"),
                    endTimeMs = word.optLong("endTime"),
                )
            },
            translatedLyric = line.optString("translatedLyric"),
            romanLyric = line.optString("romanLyric"),
            startTimeMs = line.optLong("startTime"),
            endTimeMs = line.optLong("endTime"),
            isBackground = line.optBoolean("isBG"),
            isDuet = line.optBoolean("isDuet"),
        )
    }.filter { it.words.isNotEmpty() }

    private fun parseYrc(yrc: String): List<LyricLine> {
        if (yrc.isBlank()) return emptyList()
        val lineRegex = Regex("\\[(\\d+),(\\d+)](.*)")
        val wordRegex = Regex("\\((\\d+),(\\d+),\\d+\\)([^()]*)")
        return yrc.lineSequence().mapNotNull { raw ->
            val match = lineRegex.find(raw) ?: return@mapNotNull null
            val lineStart = match.groupValues[1].toLongOrNull() ?: return@mapNotNull null
            val lineDuration = match.groupValues[2].toLongOrNull() ?: 0L
            val words = wordRegex.findAll(match.groupValues[3]).mapNotNull { wordMatch ->
                val start = wordMatch.groupValues[1].toLongOrNull() ?: return@mapNotNull null
                val duration = wordMatch.groupValues[2].toLongOrNull() ?: 0L
                val absoluteStart = if (start < lineStart && start < lineDuration) lineStart + start else start
                LyricWord(wordMatch.groupValues[3], absoluteStart, absoluteStart + duration)
            }.toList()
            if (words.isEmpty()) null else LyricLine(
                words = words,
                startTimeMs = lineStart,
                endTimeMs = lineStart + lineDuration,
            )
        }.sortedBy { it.startTimeMs }.toList()
    }

    private fun mergeLrc(original: String, translated: String, roman: String): List<LyricLine> {
        val source = parseLrc(original)
        if (source.isEmpty()) return emptyList()
        val translationMap = parseLrcMap(translated)
        val romanMap = parseLrcMap(roman)
        return source.mapIndexed { index, (time, text) ->
            val end = source.getOrNull(index + 1)?.first ?: time + 5_000
            LyricLine(
                words = listOf(LyricWord(text, time, end)),
                translatedLyric = nearest(translationMap, time),
                romanLyric = nearest(romanMap, time),
                startTimeMs = time,
                endTimeMs = end,
            )
        }
    }

    private fun mergeAuxiliary(lines: List<LyricLine>, translated: String, roman: String): List<LyricLine> {
        val translationMap = parseLrcMap(translated)
        val romanMap = parseLrcMap(roman)
        return lines.map { line ->
            line.copy(
                translatedLyric = line.translatedLyric.ifBlank { nearest(translationMap, line.startTimeMs) },
                romanLyric = line.romanLyric.ifBlank { nearest(romanMap, line.startTimeMs) },
            )
        }
    }

    private fun parseLrc(value: String): List<Pair<Long, String>> {
        val regex = Regex("\\[(\\d{1,3}):(\\d{2})(?:\\.(\\d{1,3}))?](.*)")
        return value.lineSequence().mapNotNull { line ->
            val match = regex.find(line) ?: return@mapNotNull null
            val minutes = match.groupValues[1].toLongOrNull() ?: return@mapNotNull null
            val seconds = match.groupValues[2].toLongOrNull() ?: return@mapNotNull null
            val fraction = match.groupValues[3].padEnd(3, '0').take(3).toLongOrNull() ?: 0L
            val text = match.groupValues[4].trim()
            if (text.isBlank()) null else ((minutes * 60 + seconds) * 1000 + fraction) to text
        }.sortedBy { it.first }.toList()
    }

    private fun parseLrcMap(value: String): List<Pair<Long, String>> = parseLrc(value)

    private fun nearest(values: List<Pair<Long, String>>, target: Long): String =
        values.minByOrNull { abs(it.first - target) }?.takeIf { abs(it.first - target) <= 500 }?.second.orEmpty()

    private fun parseTime(value: String): Long {
        if (value.isBlank()) return 0
        if (value.endsWith("ms")) return value.removeSuffix("ms").toDoubleOrNull()?.toLong() ?: 0
        if (value.endsWith("s")) return ((value.removeSuffix("s").toDoubleOrNull() ?: 0.0) * 1000).toLong()
        val parts = value.split(':')
        if (parts.size != 3) return 0
        val hours = parts[0].toDoubleOrNull() ?: 0.0
        val minutes = parts[1].toDoubleOrNull() ?: 0.0
        val seconds = parts[2].toDoubleOrNull() ?: 0.0
        return ((hours * 3600 + minutes * 60 + seconds) * 1000).toLong()
    }

    private fun attribute(element: Element, namespace: String?, name: String): String {
        if (namespace != null) {
            element.getAttributeNS(namespace, name).takeIf { it.isNotBlank() }?.let { return it }
        }
        return element.getAttribute(name).ifBlank { element.getAttribute("ttm:$name") }
    }
}
