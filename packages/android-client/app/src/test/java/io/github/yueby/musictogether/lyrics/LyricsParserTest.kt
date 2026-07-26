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
    fun insertsInterludesForLongTtmlGaps() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <tt xmlns="http://www.w3.org/ns/ttml">
              <body><div>
                <p begin="00:00:26.650" end="00:00:30.976"><span>第一句</span></p>
                <p begin="00:00:33.020" end="00:00:36.403"><span>第二句</span></p>
              </div></body>
            </tt>
        """.trimIndent()

        val lines = LyricsParser.parseTtml(xml)

        assertEquals(4, lines.size)
        assertTrue(lines[0].isInterlude)
        assertEquals(0L, lines[0].startTimeMs)
        assertEquals(26_650L, lines[0].endTimeMs)
        assertTrue(lines[2].isInterlude)
        assertEquals(30_976L, lines[2].startTimeMs)
        assertEquals(33_020L, lines[2].endTimeMs)
    }

    @Test
    fun usesBlankLrcTimestampsAsInterludeBoundaries() {
        val data = org.json.JSONObject().put(
            "lyric",
            "[00:26.67]第一句\n[00:30.83]\n[00:33.16]第二句",
        )

        val (lines, source) = LyricsParser.parseServerResponse(data)

        assertEquals("lrc", source)
        assertTrue(lines[0].isInterlude)
        assertEquals(26_670L, lines[0].endTimeMs)
        assertEquals(30_830L, lines[1].endTimeMs)
        assertTrue(lines[2].isInterlude)
        assertEquals(33_160L, lines[2].endTimeMs)
    }
}
