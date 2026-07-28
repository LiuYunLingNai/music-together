package io.github.yueby.musictogether.ui.player

import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.lyrics.amllWordProgress
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AmllLyricsPlaybackTest {
    @Test
    fun rapidLineBeginsWithFirstWordBeforeSecondWordProgresses() {
        val first = LyricWord("first", startTimeMs = 1_000L, endTimeMs = 1_090L)
        val second = LyricWord("second", startTimeMs = 1_090L, endTimeMs = 1_180L)

        assertEquals(0f, amllWordProgress(first, 1_000f), 0.001f)
        assertEquals(0f, amllWordProgress(second, 1_000f), 0.001f)
        assertTrue(amllWordProgress(first, 1_045f) > 0f)
        assertEquals(0f, amllWordProgress(second, 1_045f), 0.001f)
    }

    @Test
    fun matchesAmllVerticalTopAndCenteredAnchorGeometry() {
        assertEquals(
            0f,
            amllFocusDistance(
                itemOffset = 100,
                itemSize = 80,
                viewportHeight = 1_000,
                alignPosition = 0.10f,
                alignToTop = true,
            ),
            0.001f,
        )
        assertEquals(
            0f,
            amllFocusDistance(
                itemOffset = 300,
                itemSize = 100,
                viewportHeight = 1_000,
                alignPosition = 0.35f,
                alignToTop = false,
            ),
            0.001f,
        )
    }

    @Test
    fun onlyResetsFocusForInitialLayoutSeekOrNonAdjacentJump() {
        assertTrue(shouldResetAmllFocus(-1, 0, timelineDiscontinuity = false))
        assertEquals(
            false,
            shouldResetAmllFocus(4, 5, timelineDiscontinuity = false),
        )
        assertEquals(
            false,
            shouldResetAmllFocus(5, 4, timelineDiscontinuity = false),
        )
        assertTrue(shouldResetAmllFocus(4, 6, timelineDiscontinuity = false))
        assertTrue(shouldResetAmllFocus(4, 5, timelineDiscontinuity = true))
    }

    @Test
    fun backgroundVocalProgressivelyContributesItsMeasuredHeight() {
        assertEquals(0, amllBackgroundHeightContribution(48, 0f))
        assertEquals(24, amllBackgroundHeightContribution(48, 0.5f))
        assertEquals(48, amllBackgroundHeightContribution(48, 1f))
        assertEquals(48, amllBackgroundHeightContribution(48, 2f))
    }

    @Test
    fun timestampOnlyAppearsWhenTheBlankSideCanContainIt() {
        assertTrue(
            hasAmllLyricTimestampRoom(
                lyricWidthPx = 300f,
                timestampWidthPx = 44f,
                containerWidthPx = 420f,
                gapPx = 12f,
            ),
        )
        assertEquals(
            false,
            hasAmllLyricTimestampRoom(
                lyricWidthPx = 340f,
                timestampWidthPx = 44f,
                containerWidthPx = 420f,
                gapPx = 12f,
            ),
        )
    }

    @Test
    fun sharedClockIsMonotonicButSnapsForRealSeeks() {
        val corrected = extrapolateAmllPlaybackPosition(
            currentPositionMs = 1_000f,
            rawPositionMs = 980f,
            sampleAgeMs = 0f,
            deltaMs = 16f,
            isPlaying = true,
        )
        assertTrue(corrected >= 1_000f)
        assertEquals(
            5_000f,
            extrapolateAmllPlaybackPosition(
                currentPositionMs = 1_000f,
                rawPositionMs = 5_000f,
                sampleAgeMs = 0f,
                deltaMs = 16f,
                isPlaying = true,
            ),
            0.001f,
        )
        assertEquals(
            900f,
            extrapolateAmllPlaybackPosition(
                currentPositionMs = 1_000f,
                rawPositionMs = 900f,
                sampleAgeMs = 0f,
                deltaMs = 16f,
                isPlaying = false,
            ),
            0.001f,
        )
    }

    @Test
    fun detectsSmallBackwardSeeksWithoutMistakingNormalSnapshotsForSeeks() {
        assertTrue(
            isAmllTimelineSeek(
                currentPositionMs = 2_000f,
                previousRawPositionMs = 1_900f,
                rawPositionMs = 1_500f,
                sampleIntervalMs = 250f,
            ),
        )
        assertEquals(
            false,
            isAmllTimelineSeek(
                currentPositionMs = 2_000f,
                previousRawPositionMs = 1_900f,
                rawPositionMs = 2_150f,
                sampleIntervalMs = 250f,
            ),
        )
        assertTrue(
            isAmllTimelineSeek(
                currentPositionMs = 2_000f,
                previousRawPositionMs = 2_000f,
                rawPositionMs = 2_700f,
                sampleIntervalMs = 250f,
            ),
        )
    }

    @Test
    fun timelineOnlyNeedsReevaluationAtLyricsAndInterludeBoundaries() {
        val groups = listOf(group(1_000, 2_000), group(7_000, 8_000))

        assertEquals(1_000L, nextAmllTimelineBoundaryMs(groups, 0))
        assertEquals(2_000L, nextAmllTimelineBoundaryMs(groups, 1_500))
        assertEquals(6_750L, nextAmllTimelineBoundaryMs(groups, 2_000))
        assertEquals(7_000L, nextAmllTimelineBoundaryMs(groups, 6_750))
    }

    @Test
    fun timelineHandsFocusToTheNewHotGroupAndTracksSeekGeneration() {
        val groups = listOf(group(1_000, 2_000), group(2_000, 3_000))
        val first = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 1_500,
            seeking = false,
        )
        val second = advanceAmllTimelineFrame(
            previous = first,
            groups = groups,
            positionMs = 2_010,
            seeking = false,
        )
        val sought = advanceAmllTimelineFrame(
            previous = second,
            groups = groups,
            positionMs = 1_100,
            seeking = true,
        )

        assertEquals(setOf(0), first.bufferedGroupIndices)
        assertEquals(setOf(1), second.bufferedGroupIndices)
        assertEquals(1, second.focusedGroupIndex)
        assertEquals(1, second.focusDirection)
        assertEquals(setOf(0), sought.bufferedGroupIndices)
        assertEquals(second.seekGeneration + 1, sought.seekGeneration)
    }

    @Test
    fun distanceBlurDisappearsForActiveLinesAndManualBrowsing() {
        assertEquals(0f, amllLineBlurRadiusDp(4, 4, active = false, userScrolling = false))
        assertEquals(0f, amllLineBlurRadiusDp(2, 4, active = true, userScrolling = false))
        assertEquals(0f, amllLineBlurRadiusDp(2, 4, active = false, userScrolling = true))
        assertTrue(amllLineBlurRadiusDp(0, 4, active = false, userScrolling = false) > 0f)
    }

    @Test
    fun translatedLineHighlightAttacksQuicklyAndStaysBounded() {
        assertEquals(0f, amllSubLineHighlight(0f), 0.001f)
        assertTrue(amllSubLineHighlight(0.25f) > 0.5f)
        assertEquals(1f, amllSubLineHighlight(1f), 0.001f)
    }

    private fun group(start: Long, end: Long) = AmllLyricGroup(
        main = LyricLine(
            words = listOf(LyricWord("line", start, end)),
            startTimeMs = start,
            endTimeMs = end,
        ),
    )
}
