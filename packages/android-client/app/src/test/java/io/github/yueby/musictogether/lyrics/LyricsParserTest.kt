package io.github.yueby.musictogether.lyrics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsParserTest {
    @Test
    fun parsesTtmlWordsTranslationRomanAndDuet() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
              <body><div>
                <p begin="00:00:01.000" end="00:00:03.000" ttm:agent="v1">
                  <span begin="00:00:01.000" end="00:00:02.000">你</span><span begin="00:00:02.000" end="00:00:03.000">好</span>
                  <span ttm:role="x-translation">Hello</span><span ttm:role="x-roman">ni hao</span>
                </p>
                <p begin="00:00:04.000" end="00:00:05.000" ttm:agent="v2">
                  <span begin="00:00:04.000" end="00:00:05.000">世界</span>
                </p>
              </div></body>
            </tt>
        """.trimIndent()

        val lines = LyricsParser.parseTtml(xml)

        assertEquals(2, lines.size)
        assertEquals("你好", lines[0].text)
        assertEquals("Hello", lines[0].translatedLyric)
        assertEquals("ni hao", lines[0].romanLyric)
        assertFalse(lines[0].isDuet)
        assertTrue(lines[1].isDuet)
        assertEquals(4_000L, lines[1].startTimeMs)
    }

    @Test
    fun keepsTtmlParserFocusedOnSourceLines() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml">
              <body><div>
                <p begin="00:26.650" end="00:30.976"><span>第一句</span></p>
                <p begin="00:33.020" end="00:36.403"><span>第二句</span></p>
              </div></body>
            </tt>
        """.trimIndent()

        val lines = LyricsParser.parseTtml(xml)

        assertEquals(2, lines.size)
        assertEquals(26_650L, lines[0].startTimeMs)
        assertEquals(30_976L, lines[0].endTimeMs)
        assertEquals(33_020L, lines[1].startTimeMs)
    }

    @Test
    fun usesBlankLrcTimestampsAsLineEndBoundaries() {
        val data = org.json.JSONObject().put(
            "lyric",
            "[00:26.67]第一句\n[00:30.83]\n[00:33.16]第二句",
        )

        val (lines, source) = LyricsParser.parseServerResponse(data)

        assertEquals("lrc", source)
        assertEquals(2, lines.size)
        assertEquals(26_670L, lines[0].startTimeMs)
        assertEquals(30_830L, lines[0].endTimeMs)
        assertEquals(33_160L, lines[1].startTimeMs)
    }

    @Test
    fun keepsNestedRomanWordOutOfTtmlMainText() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
              <body><div>
                <p begin="00:00:01.000" end="00:00:03.000">
                  <span begin="00:00:01.000" end="00:00:02.000">你<span ttm:role="x-roman">ni</span></span>
                  <span begin="00:00:02.000" end="00:00:03.000">好<span ttm:role="x-roman">hao</span></span>
                </p>
              </div></body>
            </tt>
        """.trimIndent()

        val line = LyricsParser.parseTtml(xml).single()

        assertEquals("你好", line.text)
        assertEquals(listOf("ni", "hao"), line.words.map { it.romanText })
    }

    @Test
    fun preservesTtmlSpacesBetweenTimedLatinWords() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml">
              <body><div>
                <p begin="00:00:01.000" end="00:00:03.000"><span begin="00:00:01.000" end="00:00:02.000">something </span><span begin="00:00:02.000" end="00:00:03.000">left</span></p>
              </div></body>
            </tt>
        """.trimIndent()

        val line = LyricsParser.parseTtml(xml).single()

        assertEquals(listOf("something ", "left"), line.words.map { it.text })
        assertEquals("something left", line.text)
    }

    @Test
    fun matchesAmllBackgroundVocalWhitespaceAndParentheses() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
              <body><div>
                <p begin="54.929" end="1:01.834">
                  <span begin="54.929" end="56.688">没有妳在</span> <span begin="56.688" end="58.766">我有多难熬</span>
                  <span ttm:role="x-bg" begin="58.576" end="1:01.834"><span begin="58.576" end="59.703">(没有妳在</span> <span begin="59.703" end="1:00.702">我有多难熬</span> <span begin="1:00.702" end="1:01.834">多烦恼)</span></span>
                </p>
              </div></body>
            </tt>
        """.trimIndent()

        val lines = LyricsParser.parseTtml(xml)
        val main = lines.single { !it.isBackground }
        val background = lines.single { it.isBackground }

        assertEquals("没有妳在 我有多难熬", main.text)
        assertEquals("没有妳在 我有多难熬 多烦恼", background.text)
        assertEquals(
            listOf("没有妳在 ", "我有多难熬 ", "多烦恼"),
            background.words.map { it.text },
        )
        assertEquals(54_929L, main.startTimeMs)
        assertEquals(61_834L, main.endTimeMs)
        assertEquals(58_576L, background.words.first().startTimeMs)
        assertEquals(61_834L, background.words.last().endTimeMs)

        val optimized = prepareAmllLyricGroups(lines).single()
        assertFalse(18_000L in optimized.startTimeMs until optimized.endTimeMs)
        assertTrue(55_000L in optimized.startTimeMs until optimized.endTimeMs)
    }

    @Test
    fun parsesUntimedBackgroundTextUsingItsContainerTiming() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
              <body><div>
                <p begin="10s" end="15s"><span begin="10s" end="12s">主句</span><span ttm:role="x-bg" begin="12s" end="14s">(和声)</span></p>
              </div></body>
            </tt>
        """.trimIndent()

        val background = LyricsParser.parseTtml(xml).single { it.isBackground }

        assertEquals("和声", background.text)
        assertEquals(12_000L, background.startTimeMs)
        assertEquals(14_000L, background.endTimeMs)
        assertEquals(12_000L, background.words.single().startTimeMs)
        assertEquals(14_000L, background.words.single().endTimeMs)
    }

    @Test
    fun keepsParagraphMetadataOutOfUntimedMainText() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
              <body><div>
                <p begin="00:00:01.000" end="00:00:03.000">
                  正文
                  <span ttm:role="x-roman">zheng wen</span>
                  <span ttm:role="x-translation">main text</span>
                </p>
              </div></body>
            </tt>
        """.trimIndent()

        val line = LyricsParser.parseTtml(xml).single()

        assertEquals("正文", line.text)
    }

    @Test
    fun parsesRomanWordFromWordByWordPayload() {
        val data = org.json.JSONObject().put(
            "wordByWord",
            org.json.JSONArray().put(
                org.json.JSONObject()
                    .put("startTime", 1_000)
                    .put("endTime", 2_000)
                    .put(
                        "words",
                        org.json.JSONArray().put(
                            org.json.JSONObject()
                                .put("word", "空")
                                .put("startTime", 1_000)
                                .put("endTime", 2_000)
                                .put("romanWord", "sora"),
                        ),
                    ),
            ),
        )

        val (lines, source) = LyricsParser.parseServerResponse(data)
        val line = lines.single()

        assertEquals("wordByWord", source)
        assertEquals("sora", line.words.single().romanText)
    }

    @Test
    fun parsesTimedRubyFromWordByWordPayload() {
        val ruby = org.json.JSONObject()
            .put("word", "そら")
            .put("startTime", 1_000)
            .put("endTime", 2_000)
        val word = org.json.JSONObject()
            .put("word", "空")
            .put("startTime", 1_000)
            .put("endTime", 2_000)
            .put("ruby", org.json.JSONArray().put(ruby))
        val data = org.json.JSONObject().put(
            "wordByWord",
            org.json.JSONArray().put(
                org.json.JSONObject()
                    .put("startTime", 1_000)
                    .put("endTime", 2_000)
                    .put("words", org.json.JSONArray().put(word)),
            ),
        )

        val parsedRuby = LyricsParser.parseServerResponse(data)
            .first
            .single()
            .words
            .single()
            .ruby
            .single()

        assertEquals("そら", parsedRuby.text)
        assertEquals(1_000L, parsedRuby.startTimeMs)
        assertEquals(2_000L, parsedRuby.endTimeMs)
    }
}
