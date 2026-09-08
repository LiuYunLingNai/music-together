package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricSelectionTest {
    private fun line(
        text: String,
        start: Long,
        translated: String = "",
        isBackground: Boolean = false,
        isDuet: Boolean = false,
    ) = LyricLine(
        words = text.chunked(1).mapIndexed { index, word ->
            LyricWord(word, start + index * 100L, start + (index + 1) * 100L)
        },
        translatedLyric = translated,
        startTimeMs = start,
        endTimeMs = start + text.length * 100L,
        isBackground = isBackground,
        isDuet = isDuet,
    )

    @Test
    fun detectsMissingForeignTranslationAfterWordTimelineIsAccepted() {
        val lines = listOf(line("지금은소녀시대", 1_000), line("GeeGeeGeeGee", 3_000))

        assertTrue(evaluateLyricQuality(lines).animated)
        assertTrue(needsLyricSupplement(lines))
        assertTrue(needsLyricSupplement(lines.map { it.copy(translatedLyric = "译文") }))
        assertFalse(needsLyricSupplement(lines.map { it.copy(translatedLyric = "译文", romanLyric = "roman") }))
    }

    @Test
    fun enrichesAuxiliaryTextAcrossStableOffsetWithoutChangingAmllTiming() {
        val lines = listOf(line("第一句歌词", 11_000), line("第二句歌词", 21_000), line("第三句歌词", 31_000))
        val source = JSONObject()
            .put("lyric", "[00:10.00]第一句歌词\n[00:20.00]第二句歌词\n[00:30.00]第三句歌词")
            .put("tlyric", "[00:10.00]First\n[00:20.00]Second\n[00:30.00]Third")
            .put("romalrc", "[00:10.00]yi\n[00:20.00]er\n[00:30.00]san")

        val enriched = enrichLyricLines(lines, listOf(source))

        assertEquals(listOf("First", "Second", "Third"), enriched.map(LyricLine::translatedLyric))
        assertEquals(listOf("yi", "er", "san"), enriched.map(LyricLine::romanLyric))
        assertEquals(lines.map(LyricLine::words), enriched.map(LyricLine::words))
        assertEquals(lines.map(LyricLine::startTimeMs), enriched.map(LyricLine::startTimeMs))
    }

    @Test
    fun fillsUnmatchedLineOnlyBetweenEstablishedNeighboringAnchors() {
        val lines = listOf(line("第一句歌词", 11_000), line("完全不同正文", 21_000), line("第三句歌词", 31_000))
        val source = JSONObject()
            .put("lyric", "[00:10.00]第一句歌词\n[00:20.00]来源不同写法\n[00:30.00]第三句歌词")
            .put("tlyric", "[00:10.00]First\n[00:20.00]Second\n[00:30.00]Third")

        val enriched = enrichLyricLines(lines, listOf(source))

        assertEquals(listOf("First", "Second", "Third"), enriched.map(LyricLine::translatedLyric))
    }

    @Test
    fun keepsExistingDuetAndBackgroundStructureDuringEnrichment() {
        val lines = listOf(
            line("主唱第一句", 1_000),
            line("背景和声句", 2_000, isBackground = true),
            line("对唱第二句", 3_000, isDuet = true),
        )
        val source = JSONObject()
            .put("lyric", "[00:01.00]主唱第一句\n[00:02.00]背景和声句\n[00:03.00]对唱第二句")
            .put("tlyric", "[00:01.00]Lead\n[00:02.00]Backing\n[00:03.00]Duet")

        val enriched = enrichLyricLines(lines, listOf(source))

        assertTrue(enriched[1].isBackground)
        assertTrue(enriched[2].isDuet)
        assertEquals(lines.map(LyricLine::words), enriched.map(LyricLine::words))
    }
}
