package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.ui.player.shouldUseAmllWordAnimation
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class QrcLyricsTest {
    @Test
    fun `preserves absolute qrc word timing and text spacing`() {
        val lines = parseQrcLyrics("[1000,2000]Hello (1000,500)world!(1500,1500)")
        assertEquals("Hello world!", lines.single().text)
        assertEquals(listOf(1000L, 1500L), lines.single().words.map { it.startTimeMs })
        assertEquals(3000L, lines.single().endTimeMs)
    }

    @Test
    fun `qrc response joins qrc translation and lrc romanization`() {
        val (lines, source) = LyricsParser.parseServerResponse(JSONObject()
            .put("wordLyric", "[1000,2000]Hello (1000,500)world(1500,1500)")
            .put("wordFormat", "qrc").put("tlyric", "[1000,2000]你好世界(1000,2000)")
            .put("romalrc", "[00:01.00]hello world"))
        assertEquals("qrc", source)
        assertEquals("你好世界", lines.single().translatedLyric)
        assertEquals("hello world", lines.single().romanLyric)
        assertTrue(shouldUseAmllWordAnimation(source))
        assertTrue(shouldUseAmllWordAnimation("supplement:tencent:qrc"))
        assertFalse(shouldUseAmllWordAnimation("supplement:tencent:lrc"))
    }

    @Test
    fun `malformed qrc falls back to existing lrc without timing fabrication`() {
        val (lines, source) = LyricsParser.parseServerResponse(JSONObject()
            .put("wordLyric", "[1000,2000]untimed").put("wordFormat", "qrc").put("lyric", "[00:01.00]Fallback"))
        assertEquals("lrc", source)
        assertEquals("Fallback", lines.single().text)
        assertTrue(parseQrcLyrics("[9999999999999999999999,200]x(1,2)").isEmpty())
    }
}
