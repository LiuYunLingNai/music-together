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
}
