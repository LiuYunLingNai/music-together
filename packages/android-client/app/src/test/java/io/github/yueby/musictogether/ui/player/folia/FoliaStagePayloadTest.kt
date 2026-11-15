package io.github.yueby.musictogether.ui.player.folia

import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricRuby
import io.github.yueby.musictogether.model.LyricWord
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FoliaStagePayloadTest {
    private val track = Track("song", "歌曲", listOf("歌手"), "专辑", 30.0, "https://example.com/cover", "netease", "1", "1")
    private fun line(start: Long, end: Long, background: Boolean = false) = LyricLine(
        words = listOf(LyricWord("歌词", start, end, romanText = "ge ci", ruby = listOf(LyricRuby("注音", start, end)))),
        translatedLyric = "translation",
        startTimeMs = start,
        endTimeMs = end,
        isBackground = background,
    )

    @Test
    fun `old lyrics never cross a track handover`() {
        val document = foliaDocument(track, LyricsState(trackId = "previous", lines = listOf(line(0, 1000))), PlayerDisplaySettings())
        assertEquals(0, document.getJSONArray("lines").length())
        assertEquals("netease:song", document.getString("seed"))
    }

    @Test
    fun `background vocals ruby and romanization survive seconds conversion`() {
        val document = foliaDocument(track, LyricsState(trackId = track.id, lines = listOf(line(1000, 3000), line(1500, 2500, true))), PlayerDisplaySettings())
        val lines = document.getJSONArray("lines")
        assertEquals(1, lines.length())
        val main = lines.getJSONObject(0)
        assertEquals("ge ci", main.getString("romanization"))
        assertEquals(1.0, main.getJSONObject("backgroundVocal").getDouble("startTime"), 0.0)
        assertEquals(1.5, main.getJSONObject("backgroundVocal").getJSONArray("words").getJSONObject(0).getDouble("startTime"), 0.0)
        assertEquals("注音", main.getJSONArray("words").getJSONObject(0).getJSONArray("syllables").getJSONObject(0).getJSONArray("ruby").getJSONObject(0).getString("text"))
        assertFalse(document.has("streamUrl"))
    }

    @Test
    fun `subtitle preferences remove disabled tracks`() {
        val document = foliaDocument(track, LyricsState(trackId = track.id, lines = listOf(line(0, 1000))), PlayerDisplaySettings(showTranslation = false, showRomanization = false))
        val main = document.getJSONArray("lines").getJSONObject(0)
        assertEquals("", main.getString("translation"))
        assertEquals("", main.getString("romanization"))
        assertEquals("none", document.getString("subtitleContentMode"))
        assertTrue(document.getBoolean("hideTranslationSubtitle"))
    }

    @Test
    fun `stage customization keeps alternate text while preserving native display defaults`() {
        val document = foliaDocument(
            track,
            LyricsState(trackId = track.id, lines = listOf(line(0, 1000))),
            PlayerDisplaySettings(showTranslation = false, showRomanization = false),
            preserveAlternateText = true,
        )
        val main = document.getJSONArray("lines").getJSONObject(0)
        assertEquals("translation", main.getString("translation"))
        assertEquals("ge ci", main.getString("romanization"))
        assertFalse(document.getBoolean("showSubtitleTranslation"))
        assertFalse(document.getBoolean("showSubtitleRomanization"))
    }

    @Test
    fun `seek and offset use the same line and word position`() {
        val lines = listOf(line(1000, 2000), line(2000, 3000))
        assertEquals(1500f, foliaLyricPositionMs(2.0, 500), 0f)
        assertEquals(0, foliaLineIndex(lines, foliaLyricPositionMs(2.0, 500)))
        assertEquals(1, foliaLineIndex(lines, 2000f))
        assertEquals(-1, foliaLineIndex(lines, 3000f))
        assertEquals(0f, foliaLyricPositionMs(0.1, 500), 0f)
    }
}
