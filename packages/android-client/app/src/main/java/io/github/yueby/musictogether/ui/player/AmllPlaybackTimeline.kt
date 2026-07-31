package io.github.yueby.musictogether.ui.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import io.github.yueby.musictogether.lyrics.AmllInterlude
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.lyrics.findAmllInterlude
import io.github.yueby.musictogether.lyrics.isAmllInterludeActiveAt
import kotlin.math.abs
import kotlin.math.max

private const val AmllClockSnapThresholdMs = 2_000f
private const val AmllClockMaximumExtrapolationMs = 750f
private const val AmllClockMaximumLeadMs = 16f

internal data class AmllTimelineFrame(
    val hotGroupIndices: Set<Int> = emptySet(),
    val bufferedGroupIndices: Set<Int> = emptySet(),
    val focusedGroupIndex: Int = -1,
    val focusDirection: Int = 0,
    val interlude: AmllInterlude? = null,
    val seekGeneration: Int = 0,
)

internal data class AmllPlaybackTimeline(
    val positionMs: State<Float>,
    val frame: State<AmllTimelineFrame>,
)

internal fun advanceAmllTimelineFrame(
    previous: AmllTimelineFrame,
    groups: List<AmllLyricGroup>,
    positionMs: Long,
    seeking: Boolean,
): AmllTimelineFrame {
    if (groups.isEmpty()) {
        return AmllTimelineFrame(
            seekGeneration = previous.seekGeneration + if (seeking) 1 else 0,
        )
    }

    val hot = groups.indices
        .filterTo(linkedSetOf()) { index ->
            positionMs >= groups[index].startTimeMs &&
                positionMs < groups[index].endTimeMs
        }
    val buffered = if (seeking) {
        hot.toMutableSet()
    } else {
        previous.bufferedGroupIndices.toMutableSet().apply {
            val added = hot - previous.hotGroupIndices
            val expired = this - hot
            when {
                added.isNotEmpty() -> {
                    addAll(added)
                    removeAll(expired)
                }

                expired.isNotEmpty() && expired.size == size -> clear()
            }
        }
    }

    val timelineIndex = hot.lastOrNull()
        ?: groups.indexOfLast { positionMs >= it.startTimeMs }
    val detectedInterlude = findAmllInterlude(groups, positionMs, timelineIndex)
    val interlude = if (seeking && detectedInterlude != null) {
        detectedInterlude.copy(
            startTimeMs = maxOf(detectedInterlude.startTimeMs, positionMs),
        )
    } else {
        detectedInterlude
    }
    val focused = when {
        interlude != null ->
            (interlude.anchorGroupIndex + 1).coerceIn(groups.indices)

        buffered.isNotEmpty() -> buffered.min()
        timelineIndex >= 0 -> timelineIndex
        else -> 0
    }
    val direction = when {
        previous.focusedGroupIndex < 0 -> 0
        focused > previous.focusedGroupIndex -> 1
        focused < previous.focusedGroupIndex -> -1
        else -> previous.focusDirection
    }

    return AmllTimelineFrame(
        hotGroupIndices = hot,
        bufferedGroupIndices = buffered,
        focusedGroupIndex = focused,
        focusDirection = direction,
        interlude = interlude,
        seekGeneration = previous.seekGeneration + if (seeking) 1 else 0,
    )
}

internal fun extrapolateAmllPlaybackPosition(
    currentPositionMs: Float,
    rawPositionMs: Float,
    sampleAgeMs: Float,
    deltaMs: Float,
    isPlaying: Boolean,
): Float {
    if (!isPlaying) return rawPositionMs
    val boundedAge = sampleAgeMs.coerceIn(0f, AmllClockMaximumExtrapolationMs)
    val target = rawPositionMs + boundedAge
    val error = target - currentPositionMs
    if (abs(error) > AmllClockSnapThresholdMs) return target
    if (deltaMs <= 0f) return currentPositionMs

    val speed = (1f + error / 1_000f * 0.32f).coerceIn(0f, 1.24f)
    val advanced = currentPositionMs + deltaMs * speed
    return when {
        advanced > target + AmllClockMaximumLeadMs ->
            maxOf(currentPositionMs, target + AmllClockMaximumLeadMs)

        else -> maxOf(currentPositionMs, advanced)
    }
}

internal fun isAmllTimelineSeek(
    currentPositionMs: Float,
    previousRawPositionMs: Float,
    rawPositionMs: Float,
    sampleIntervalMs: Float,
): Boolean {
    val rawDelta = rawPositionMs - previousRawPositionMs
    // AMLL treats every backwards movement as a seek. Media3's playback
    // position is monotonic during normal playback, so even a small negative
    // delta represents a real discontinuity.
    if (rawDelta < 0f) return true
    if (abs(rawPositionMs - currentPositionMs) > AmllClockSnapThresholdMs) return true
    val maximumExpectedAdvance = max(350f, sampleIntervalMs * 1.75f + 120f)
    return rawDelta > maximumExpectedAdvance
}

internal fun shouldReevaluateAmllTimeline(
    frame: AmllTimelineFrame,
    positionMs: Long,
    seeking: Boolean,
    playbackChanged: Boolean,
    nextTimelineBoundaryMs: Long,
): Boolean {
    val expiredInterlude = frame.interlude?.let { interlude ->
        !isAmllInterludeActiveAt(interlude, positionMs)
    } == true
    return seeking ||
        playbackChanged ||
        expiredInterlude ||
        positionMs >= nextTimelineBoundaryMs
}

internal fun shouldAdvanceAmllClockFrame(
    elapsedNanos: Long,
    minimumFrameIntervalNanos: Long,
    rawPositionChanged: Boolean,
    playbackChanged: Boolean,
): Boolean =
    rawPositionChanged ||
        playbackChanged ||
        minimumFrameIntervalNanos <= 0L ||
        elapsedNanos >= minimumFrameIntervalNanos

internal fun nextAmllTimelineBoundaryMs(
    groups: List<AmllLyricGroup>,
    positionMs: Long,
): Long {
    var next = Long.MAX_VALUE
    fun include(candidate: Long) {
        if (candidate > positionMs && candidate < next) next = candidate
    }

    groups.forEachIndexed { index, group ->
        include(group.startTimeMs)
        include(group.endTimeMs)
        val previousEnd = groups.getOrNull(index - 1)?.endTimeMs ?: 0L
        val interludeEnd = group.startTimeMs - 250L
        if (interludeEnd - previousEnd >= 4_000L) include(interludeEnd)
    }
    return next
}

@Composable
internal fun rememberAmllPlaybackTimeline(
    groups: List<AmllLyricGroup>,
    rawPositionMs: Float,
    isPlaying: Boolean,
    resetKey: Any?,
    minimumFrameIntervalNanos: Long = 0L,
): AmllPlaybackTimeline {
    val position = remember(resetKey) { mutableFloatStateOf(rawPositionMs) }
    val lastRawSample = remember(resetKey) { mutableFloatStateOf(rawPositionMs) }
    val frame = remember(resetKey, groups) {
        mutableStateOf(
            advanceAmllTimelineFrame(
                previous = AmllTimelineFrame(),
                groups = groups,
                positionMs = rawPositionMs.toLong(),
                seeking = true,
            ),
        )
    }
    val latestRawPosition by rememberUpdatedState(rawPositionMs)
    val latestPlaying by rememberUpdatedState(isPlaying)
    val latestGroups by rememberUpdatedState(groups)
    val latestMinimumFrameIntervalNanos by rememberUpdatedState(minimumFrameIntervalNanos)
    val pausedPositionKey = if (isPlaying) null else rawPositionMs

    LaunchedEffect(resetKey, groups, isPlaying, pausedPositionKey) {
        if (!isPlaying) {
            // Stopping playback can leave the extrapolated clock a few
            // milliseconds ahead of the latest Media3 sample; that is not a
            // Seek. Once already paused, a changed raw sample is a real jump.
            val seeking = rawPositionMs != lastRawSample.floatValue
            lastRawSample.floatValue = rawPositionMs
            position.floatValue = rawPositionMs
            val pausedFrame = advanceAmllTimelineFrame(
                previous = frame.value,
                groups = groups,
                positionMs = rawPositionMs.toLong(),
                seeking = seeking,
            )
            if (pausedFrame != frame.value) frame.value = pausedFrame
            return@LaunchedEffect
        }

        var lastFrameNanos = 0L
        var rawSampleNanos = 0L
        var previousRawPosition = lastRawSample.floatValue
        var previousPlaying = latestPlaying
        var nextTimelineBoundary = nextAmllTimelineBoundaryMs(
            groups = latestGroups,
            positionMs = position.floatValue.toLong(),
        )

        while (true) {
            withFrameNanos { frameNanos ->
                if (lastFrameNanos == 0L) {
                    lastFrameNanos = frameNanos
                    rawSampleNanos = frameNanos
                }

                val rawChanged = latestRawPosition != previousRawPosition
                val playbackChanged = latestPlaying != previousPlaying
                if (!shouldAdvanceAmllClockFrame(
                        elapsedNanos = (frameNanos - lastFrameNanos).coerceAtLeast(0L),
                        minimumFrameIntervalNanos = latestMinimumFrameIntervalNanos,
                        rawPositionChanged = rawChanged,
                        playbackChanged = playbackChanged,
                    )
                ) {
                    return@withFrameNanos
                }
                var seeking = false
                if (rawChanged) {
                    val sampleIntervalMs =
                        (frameNanos - rawSampleNanos).coerceAtLeast(0L) / 1_000_000f
                    seeking = isAmllTimelineSeek(
                        currentPositionMs = position.floatValue,
                        previousRawPositionMs = previousRawPosition,
                        rawPositionMs = latestRawPosition,
                        sampleIntervalMs = sampleIntervalMs,
                    )
                    rawSampleNanos = frameNanos
                    previousRawPosition = latestRawPosition
                    lastRawSample.floatValue = latestRawPosition
                    if (seeking) position.floatValue = latestRawPosition
                }
                if (playbackChanged) {
                    rawSampleNanos = frameNanos
                    previousPlaying = latestPlaying
                }

                val deltaMs =
                    (frameNanos - lastFrameNanos).coerceAtLeast(0L) / 1_000_000f
                val sampleAgeMs =
                    (frameNanos - rawSampleNanos).coerceAtLeast(0L) / 1_000_000f
                position.floatValue = extrapolateAmllPlaybackPosition(
                    currentPositionMs = position.floatValue,
                    rawPositionMs = latestRawPosition,
                    sampleAgeMs = sampleAgeMs,
                    deltaMs = deltaMs,
                    isPlaying = latestPlaying,
                )

                val timelinePositionMs = position.floatValue.toLong()
                if (shouldReevaluateAmllTimeline(
                        frame = frame.value,
                        positionMs = timelinePositionMs,
                        seeking = seeking,
                        playbackChanged = playbackChanged,
                        nextTimelineBoundaryMs = nextTimelineBoundary,
                    )
                ) {
                    val nextFrame = advanceAmllTimelineFrame(
                        previous = frame.value,
                        groups = latestGroups,
                        positionMs = timelinePositionMs,
                        seeking = seeking,
                    )
                    if (nextFrame != frame.value) frame.value = nextFrame
                    nextTimelineBoundary = nextAmllTimelineBoundaryMs(
                        groups = latestGroups,
                        positionMs = timelinePositionMs,
                    )
                }
                lastFrameNanos = frameNanos
            }
        }
    }

    return remember(position, frame) {
        AmllPlaybackTimeline(positionMs = position, frame = frame)
    }
}
