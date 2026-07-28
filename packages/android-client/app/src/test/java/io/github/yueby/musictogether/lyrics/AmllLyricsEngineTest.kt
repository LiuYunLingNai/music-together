package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricRuby
import io.github.yueby.musictogether.model.LyricWord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AmllLyricsEngineTest {
    @Test
    fun optimizesAndGroupsFollowingBackgroundLineLikeAmll() {
        val main = line(
            words = listOf(word("主", 2_000, 3_000)),
            start = 1_800,
            end = 3_000,
        )
        val background = line(
            words = listOf(word("和", 1_700, 3_200)),
            start = 1_700,
            end = 3_200,
            background = true,
        )

        val group = prepareAmllLyricGroups(listOf(main, background)).single()

        assertNotNull(group.background)
        assertEquals(1_100L, group.startTimeMs)
        assertEquals(3_200L, group.endTimeMs)
        assertEquals(group.startTimeMs, group.background?.startTimeMs)
        assertEquals(group.endTimeMs, group.background?.endTimeMs)
    }

    @Test
    fun derivesInterludeOnlyForAmllFourSecondGap() {
        val groups = prepareAmllLyricGroups(
            listOf(
                line(listOf(word("前", 1_000, 2_000)), 1_000, 2_000),
                line(listOf(word("后", 7_000, 8_000)), 7_000, 8_000, duet = true),
            ),
        )

        val interlude = findAmllInterlude(
            groups = groups,
            currentTimeMs = 3_000,
            currentGroupIndex = 0,
        )

        assertNotNull(interlude)
        assertEquals(2_000L, interlude?.startTimeMs)
        assertEquals(6_150L, interlude?.endTimeMs)
        assertTrue(interlude?.isNextDuet == true)
        assertEquals(
            null,
            findAmllInterlude(groups, currentTimeMs = 6_500, currentGroupIndex = 0),
        )
    }

    @Test
    fun chunksCjkByGraphemeAndKeepsLatinFragmentsTogether() {
        val chunks = chunkAmllWords(
            line(
                words = listOf(
                    word("你好", 1_000, 2_000),
                    word(" ", 2_000, 2_000),
                    word("good", 2_000, 2_400),
                    word("bye", 2_400, 3_000),
                ),
                start = 1_000,
                end = 3_000,
            ),
        )

        assertEquals(listOf("你", "好", " ", "goodbye"), chunks.map { it.text })
        assertEquals(2, chunks.last().words.size)
    }

    @Test
    fun emphasizesLongWordsButNotShortSingleLatinGlyphs() {
        assertTrue(shouldAmllEmphasize(word("长", 0, 1_100)))
        assertTrue(shouldAmllEmphasize(word("hold", 0, 1_100)))
        assertFalse(shouldAmllEmphasize(word("a", 0, 1_100)))
        assertFalse(shouldAmllEmphasize(word("short", 0, 900)))
    }

    @Test
    fun usesAmllDynamicProgrammingForBalancedBreaks() {
        val breaks = calculateAmllBalancedBreaks(
            children = listOf(
                AmllMeasuredChunk(40.0, "A", false),
                AmllMeasuredChunk(10.0, " ", true),
                AmllMeasuredChunk(40.0, "B", false),
                AmllMeasuredChunk(10.0, " ", true),
                AmllMeasuredChunk(40.0, "C", false),
            ),
            containerWidth = 90.0,
        )

        assertEquals(listOf(2), breaks)
    }

    @Test
    fun usesAmllAdaptiveLineSpringProfiles() {
        val rapid = amllLineSpringParameters(
            currentStartTimeMs = 1_100,
            previousStartTimeMs = 1_000,
            stabilize = false,
        )
        val relaxed = amllLineSpringParameters(
            currentStartTimeMs = 1_800,
            previousStartTimeMs = 1_000,
            stabilize = false,
        )
        val seeking = amllLineSpringParameters(
            currentStartTimeMs = 1_800,
            previousStartTimeMs = 1_000,
            stabilize = true,
        )

        assertEquals(220f, rapid.stiffness, 0.001f)
        assertEquals(170f, relaxed.stiffness, 0.001f)
        assertEquals(1.1f, rapid.dampingRatio, 0.001f)
        assertEquals(90f, seeking.stiffness, 0.001f)
        assertEquals(15f, seeking.damping, 0.001f)
    }

    @Test
    fun keepsLatinWhitespaceAsAnIndependentLayoutChunk() {
        val chunks = chunkAmllWords(
            line(
                words = listOf(
                    word("something ", 1_000, 1_600),
                    word("left ", 1_600, 2_000),
                    word("to lose", 2_000, 2_800),
                ),
                start = 1_000,
                end = 2_800,
            ),
        )

        assertEquals(
            listOf("something", " ", "left", " ", "to", " ", "lose"),
            chunks.map(AmllWordChunk::text),
        )
    }

    @Test
    fun matchesAmllHalfHeightMaskTravel() {
        val middle = amllMaskBoundaries(
            progress = 0.5f,
            width = 100f,
            height = 100f,
        )

        assertEquals(0.25f, middle.brightEndFraction, 0.0001f)
        assertEquals(0.75f, middle.fadeEndFraction, 0.0001f)
        assertEquals(
            0.5f,
            amllMaskAlphaAt(0.5f, 0.5f, width = 100f, height = 100f),
            0.0001f,
        )
        assertEquals(0f, amllMaskAlphaAt(0f, 0f, 100f, 100f), 0.0001f)
        assertEquals(1f, amllMaskAlphaAt(1f, 1f, 100f, 100f), 0.0001f)
    }

    @Test
    fun emphasisEasingPeaksAtAmllMidpoint() {
        assertEquals(0f, amllEmphasisEasing(0f), 0.0001f)
        assertEquals(1f, amllEmphasisEasing(0.5f), 0.0001f)
        assertEquals(0f, amllEmphasisEasing(1f), 0.0001f)
    }

    @Test
    fun rubyWordRemainsOneTimedLayoutChunk() {
        val rubyWord = LyricWord(
            text = "空",
            startTimeMs = 1_000,
            endTimeMs = 2_000,
            ruby = listOf(LyricRuby("そら", 1_000, 2_000)),
        )

        val chunks = chunkAmllWords(
            line(
                words = listOf(rubyWord),
                start = 1_000,
                end = 2_000,
            ),
        )

        assertEquals(1, chunks.size)
        assertEquals(listOf(rubyWord), chunks.single().words)
    }

    private fun word(
        text: String,
        start: Long,
        end: Long,
    ) = LyricWord(text, start, end)

    private fun line(
        words: List<LyricWord>,
        start: Long,
        end: Long,
        background: Boolean = false,
        duet: Boolean = false,
    ) = LyricLine(
        words = words,
        startTimeMs = start,
        endTimeMs = end,
        isBackground = background,
        isDuet = duet,
    )
}
