package io.github.yueby.musictogether.ui.player

import androidx.compose.ui.geometry.Rect
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.lyrics.AmllInterlude
import io.github.yueby.musictogether.lyrics.amllWordProgress
import io.github.yueby.musictogether.lyrics.findAmllInterlude
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
    fun keepsMobileTopAndLandscapeCenteredAnchorGeometry() {
        assertEquals(
            0f,
            amllFocusDistance(
                itemOffset = 100,
                itemSize = 80,
                viewportHeight = 1_000,
                alignPosition = AmllPortraitAlignPosition,
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
                alignPosition = AmllCenteredAlignPosition,
                alignToTop = false,
            ),
            0.001f,
        )
    }

    @Test
    fun onlyResetsFocusForInitialLayoutOrTimelineDiscontinuity() {
        assertTrue(shouldResetAmllFocus(-1, timelineDiscontinuity = false))
        assertEquals(
            false,
            shouldResetAmllFocus(4, timelineDiscontinuity = false),
        )
        assertTrue(shouldResetAmllFocus(4, timelineDiscontinuity = true))
    }

    @Test
    fun initialListCompositionStartsAtTheCurrentFocusedLyric() {
        assertEquals(18, initialAmllListIndex(focusedListIndex = 18, itemCount = 50))
        assertEquals(0, initialAmllListIndex(focusedListIndex = -1, itemCount = 50))
        assertEquals(49, initialAmllListIndex(focusedListIndex = 60, itemCount = 50))
        assertEquals(0, initialAmllListIndex(focusedListIndex = 0, itemCount = 0))
    }

    @Test
    fun emphasisScaleUsesTheTextBaselineAsItsTransformOrigin() {
        assertEquals(0.8f, amllBaselineTransformOrigin(40, 50), 0.0001f)
        assertEquals(1f, amllBaselineTransformOrigin(-1, 50), 0.0001f)
        assertEquals(1f, amllBaselineTransformOrigin(0, 0), 0.0001f)
    }

    @Test
    fun normalAndEmphasizedChunksShareTheSameFlowLineBaseline() {
        val lineBaseline = maxOf(40, 32)
        val normalTop = amllBaselinePlacementOffset(lineBaseline, 40)
        val emphasizedTop = amllBaselinePlacementOffset(lineBaseline, 32)

        assertEquals(lineBaseline, normalTop + 40)
        assertEquals(lineBaseline, emphasizedTop + 32)
    }

    @Test
    fun backgroundVocalProgressivelyContributesItsMeasuredHeight() {
        assertEquals(0, amllBackgroundHeightContribution(48, 0f))
        assertEquals(24, amllBackgroundHeightContribution(48, 0.5f))
        assertEquals(48, amllBackgroundHeightContribution(48, 1f))
        assertEquals(48, amllBackgroundHeightContribution(48, 2f))
    }

    @Test
    fun timestampKeepsItsFixedSideAndUsesTheActualWrappedVisualLineForCollision() {
        val container = Rect(0f, 0f, 420f, 800f)

        assertEquals(
            356f,
            amllFixedTimestampXInRoot(
                visualLine = Rect(20f, 100f, 332f, 140f),
                timestampWidthPx = 44f,
                containerBoundsInRoot = container,
                horizontalInsetPx = 20f,
                gapPx = 12f,
                preferLeft = false,
            )!!,
            0.001f,
        )
        assertEquals(
            null,
            amllFixedTimestampXInRoot(
                visualLine = Rect(100f, 160f, 400f, 200f),
                timestampWidthPx = 44f,
                containerBoundsInRoot = container,
                horizontalInsetPx = 20f,
                gapPx = 12f,
                preferLeft = false,
            ),
        )
        assertNull(
            amllFixedTimestampXInRoot(
                visualLine = Rect(20f, 220f, 400f, 260f),
                timestampWidthPx = 44f,
                containerBoundsInRoot = container,
                horizontalInsetPx = 20f,
                gapPx = 12f,
                preferLeft = false,
            ),
        )
    }

    @Test
    fun duetTimestampPrefersTheBlankLeftSide() {
        assertEquals(
            20f,
            amllFixedTimestampXInRoot(
                visualLine = Rect(140f, 100f, 400f, 140f),
                timestampWidthPx = 44f,
                containerBoundsInRoot = Rect(0f, 0f, 420f, 800f),
                horizontalInsetPx = 20f,
                gapPx = 12f,
                preferLeft = true,
            )!!,
            0.001f,
        )
    }

    @Test
    fun previewOverlayRejectsGeometryMeasuredForAnOldSelection() {
        val current = IndexedValue(index = 7, value = Rect(20f, 100f, 300f, 160f))

        assertEquals(current.value, amllMeasurementForGroup(current, groupIndex = 7))
        assertNull(amllMeasurementForGroup(current, groupIndex = 8))
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
    fun sharedClockDoesNotRunFarEnoughAheadToSkipFastOpeningWords() {
        val corrected = extrapolateAmllPlaybackPosition(
            currentPositionMs = 1_000f,
            rawPositionMs = 1_000f,
            sampleAgeMs = 0f,
            deltaMs = 100f,
            isPlaying = true,
        )

        assertEquals(1_016f, corrected, 0.001f)
    }

    @Test
    fun emphasisHeadroomDoesNotChangeTheWordLayoutAdvance() {
        assertEquals(
            100,
            amllCollapsedEffectWidth(
                measuredWidthPx = 180,
                horizontalHeadroomPx = 40,
            ),
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
        assertTrue(
            isAmllTimelineSeek(
                currentPositionMs = 2_000f,
                previousRawPositionMs = 1_900f,
                rawPositionMs = 1_850f,
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
    fun displayedInterludeFollowsCurrentPlaybackPosition() {
        val groups = listOf(group(1_000, 2_000), group(7_000, 8_000))

        assertNull(findAmllInterlude(groups, 1_979))
        assertNotNull(findAmllInterlude(groups, 2_000))
        assertNotNull(findAmllInterlude(groups, 6_729))
        assertNull(findAmllInterlude(groups, 6_730))
        assertNull(findAmllInterlude(groups, 7_000))
    }

    @Test
    fun inactiveInterludesNeverAddPermanentLyricListSpacing() {
        val groups = listOf(group(1_000, 2_000), group(7_000, 8_000))

        val items = buildAmllListItems(
            trackId = "track",
            groups = groups,
        )

        assertEquals(2, items.size)
        assertEquals(listOf(0, 1), items.map { it.groupIndex })
    }

    @Test
    fun activeInterludeDoesNotChangeLyricListStructure() {
        val groups = listOf(group(1_000, 2_000), group(7_000, 8_000))

        val items = buildAmllListItems(
            trackId = "track",
            groups = groups,
        )

        assertEquals(2, items.size)
        assertEquals(listOf(0, 1), items.map { it.groupIndex })
    }

    @Test
    fun seekingIntoInterludeRestartsItsEntranceAtSeekPosition() {
        val frame = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = listOf(group(1_000, 2_000), group(9_000, 10_000)),
            positionMs = 5_000,
            seeking = true,
        )

        assertEquals(5_000L, frame.interlude?.startTimeMs)
        assertEquals(8_750L, frame.interlude?.endTimeMs)
    }

    @Test
    fun expiredInterludeForcesTimelineReevaluationWithoutScheduledBoundary() {
        val groups = listOf(group(1_000, 2_000), group(7_000, 8_000))
        val activeFrame = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 3_000,
            seeking = false,
        )

        assertNotNull(activeFrame.interlude)
        assertEquals(
            false,
            shouldReevaluateAmllTimeline(
                frame = activeFrame,
                positionMs = 3_000,
                seeking = false,
                playbackChanged = false,
                nextTimelineBoundaryMs = Long.MAX_VALUE,
            ),
        )
        assertTrue(
            shouldReevaluateAmllTimeline(
                frame = activeFrame,
                positionMs = 6_730,
                seeking = false,
                playbackChanged = false,
                nextTimelineBoundaryMs = Long.MAX_VALUE,
            ),
        )
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
    fun plainLyricsPrepositionTheNextLineWithoutActivatingItEarly() {
        val groups = listOf(group(1_000, 2_000), group(2_000, 3_000))

        val frame = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 1_700,
            seeking = false,
            focusLeadTimeMs = 300,
        )

        assertEquals(setOf(0), frame.bufferedGroupIndices)
        assertEquals(1, frame.focusedGroupIndex)
        assertEquals(
            1_700L,
            nextAmllTimelineBoundaryMs(
                groups = groups,
                positionMs = 1_600,
                focusLeadTimeMs = 300,
            ),
        )
    }

    @Test
    fun plainLyricsDoNotAnticipateFocusDuringSeek() {
        val groups = listOf(group(1_000, 2_000), group(2_000, 3_000))

        val frame = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 1_700,
            seeking = true,
            focusLeadTimeMs = 300,
        )

        assertEquals(setOf(0), frame.bufferedGroupIndices)
        assertEquals(0, frame.focusedGroupIndex)
    }

    @Test
    fun rapidPlainLyricsNeverSkipAheadDuringPrepositioning() {
        val groups = listOf(
            group(1_000, 1_200),
            group(1_200, 1_400),
            group(1_400, 1_600),
        )

        val frame = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 1_150,
            seeking = false,
            focusLeadTimeMs = 300,
        )

        assertEquals(setOf(0), frame.bufferedGroupIndices)
        assertEquals(0, frame.focusedGroupIndex)
    }

    @Test
    fun simultaneousLinesAdvanceContinuouslyToTheFollowingGroup() {
        val groups = listOf(
            group(1_000, 3_000),
            group(1_100, 3_000),
            group(3_000, 4_000),
        )
        val simultaneous = advanceAmllTimelineFrame(
            previous = AmllTimelineFrame(),
            groups = groups,
            positionMs = 1_500,
            seeking = false,
        )
        val following = advanceAmllTimelineFrame(
            previous = simultaneous,
            groups = groups,
            positionMs = 3_010,
            seeking = false,
        )

        assertEquals(setOf(0, 1), simultaneous.bufferedGroupIndices)
        assertEquals(0, simultaneous.focusedGroupIndex)
        assertEquals(setOf(2), following.bufferedGroupIndices)
        assertEquals(2, following.focusedGroupIndex)
        assertEquals(
            false,
            shouldResetAmllFocus(
                previousGroupIndex = simultaneous.focusedGroupIndex,
                timelineDiscontinuity = false,
            ),
        )
    }

    @Test
    fun matchesUpstreamMaskAndGroupTransitionValues() {
        assertEquals(0.10f, AmllPortraitAlignPosition, 0.001f)
        assertEquals(0.35f, AmllCenteredAlignPosition, 0.001f)
        assertEquals(0.10f, AmllTopFadeEnd, 0.001f)
        assertEquals(0.91f, AmllBottomFadeStart, 0.001f)
        assertEquals(300, AmllMaskAttackDurationMs)
        assertEquals(450, AmllMaskReleaseDurationMs)
        assertEquals(0.85f, amllGroupTargetAlpha(active = true), 0.001f)
        assertEquals(1f, amllGroupTargetAlpha(active = false), 0.001f)
        assertEquals(0.2f, amllInactiveMainLineAlpha(readingMode = false), 0.001f)
        assertEquals(0.4f, amllInactiveMainLineAlpha(readingMode = true), 0.001f)
        assertEquals(false, shouldRevealAmllBackground(active = false, readingMode = false))
        assertTrue(shouldRevealAmllBackground(active = true, readingMode = false))
        assertTrue(shouldRevealAmllBackground(active = false, readingMode = true))
        assertEquals(50f, AmllMainScaleStiffness, 0.001f)
        assertEquals(0.8839f, AmllMainScaleDampingRatio, 0.001f)
        assertEquals(50f, AmllBackgroundScaleStiffness, 0.001f)
        assertEquals(1.4142f, AmllBackgroundScaleDampingRatio, 0.001f)
    }

    @Test
    fun onlyEnablesWordAnimationForTimedLyricSources() {
        assertEquals(false, shouldUseAmllWordAnimation("lrc"))
        assertEquals(false, shouldUseAmllWordAnimation(null))
        assertTrue(shouldUseAmllWordAnimation("ttml"))
        assertTrue(shouldUseAmllWordAnimation("wordByWord"))
        assertTrue(shouldUseAmllWordAnimation("yrc"))
    }

    @Test
    fun lowPowerPolicyKeepsTimingButDropsExpensiveEffects() {
        val normal = amllMotionPolicy(
            animatorsEnabled = true,
            powerSaveMode = false,
        )
        val powerSaving = amllMotionPolicy(
            animatorsEnabled = true,
            powerSaveMode = true,
        )
        val animationsDisabled = amllMotionPolicy(
            animatorsEnabled = false,
            powerSaveMode = false,
        )

        assertEquals(AmllNormalFrameIntervalNanos, normal.minimumFrameIntervalNanos)
        assertTrue(normal.expensiveEffectsEnabled)
        assertEquals(AmllPowerSavingFrameIntervalNanos, powerSaving.minimumFrameIntervalNanos)
        assertEquals(false, powerSaving.expensiveEffectsEnabled)
        assertEquals(
            AmllPowerSavingFrameIntervalNanos,
            animationsDisabled.minimumFrameIntervalNanos,
        )
        assertEquals(false, animationsDisabled.expensiveEffectsEnabled)
    }

    @Test
    fun inactiveDynamicLinesReturnToSolidRenderingAfterRelease() {
        assertTrue(
            shouldUseAmllGradientRenderMode(
                hasDynamicTiming = true,
                active = true,
                effectReleaseProgress = 1f,
            ),
        )
        assertTrue(
            shouldUseAmllGradientRenderMode(
                hasDynamicTiming = true,
                active = false,
                effectReleaseProgress = 0.5f,
            ),
        )
        assertEquals(
            false,
            shouldUseAmllGradientRenderMode(
                hasDynamicTiming = true,
                active = false,
                effectReleaseProgress = 0f,
            ),
        )
    }

    @Test
    fun interludeReservesDotHeightAndLineGap() {
        assertEquals(30.6f, amllInterludeReservedHeight(30f), 0.001f)
    }

    @Test
    fun interludeCanvasMatchesAmllEntranceAndExitPhases() {
        val interlude = AmllInterlude(
            startTimeMs = 1_000,
            endTimeMs = 6_000,
            anchorGroupIndex = 0,
            isNextDuet = false,
        )
        val entrance = amllInterludeVisualState(interlude, 1_000f)
        val visible = amllInterludeVisualState(interlude, 2_500f)
        val exit = amllInterludeVisualState(interlude, 6_000f)

        assertEquals(0f, entrance.scale, 0.001f)
        assertTrue(visible.scale > 0f)
        assertTrue(visible.dotAlphas.first() > 0f)
        assertEquals(0f, exit.dotAlphas.max(), 0.001f)
    }

    @Test
    fun throttledClockStillProcessesFreshPlayerSamplesImmediately() {
        assertEquals(
            false,
            shouldAdvanceAmllClockFrame(
                elapsedNanos = 16_000_000L,
                minimumFrameIntervalNanos = AmllPowerSavingFrameIntervalNanos,
                rawPositionChanged = false,
                playbackChanged = false,
            ),
        )
        assertTrue(
            shouldAdvanceAmllClockFrame(
                elapsedNanos = 34_000_000L,
                minimumFrameIntervalNanos = AmllPowerSavingFrameIntervalNanos,
                rawPositionChanged = false,
                playbackChanged = false,
            ),
        )
        assertTrue(
            shouldAdvanceAmllClockFrame(
                elapsedNanos = 1_000_000L,
                minimumFrameIntervalNanos = AmllPowerSavingFrameIntervalNanos,
                rawPositionChanged = true,
                playbackChanged = false,
            ),
        )
    }

    @Test
    fun duetTracksReserveTheOppositeSideWithoutChangingSoloLyrics() {
        assertEquals(0f to 0f, amllDuetInsetFractions(hasDuetLines = false, isDuet = false))
        assertEquals(
            0f to AmllDuetInsetFraction,
            amllDuetInsetFractions(hasDuetLines = true, isDuet = false),
        )
        assertEquals(
            AmllDuetInsetFraction to 0f,
            amllDuetInsetFractions(hasDuetLines = true, isDuet = true),
        )
    }

    private fun group(start: Long, end: Long) = AmllLyricGroup(
        main = LyricLine(
            words = listOf(LyricWord("line", start, end)),
            startTimeMs = start,
            endTimeMs = end,
        ),
    )
}
