package io.github.yueby.musictogether.lyrics

import kotlin.math.pow
import kotlin.math.sqrt

internal fun findAmllInterlude(
    groups: List<AmllLyricGroup>,
    currentTimeMs: Long,
    currentGroupIndex: Int,
): AmllInterlude? {
    fun checkGap(anchorIndex: Int): AmllInterlude? {
        if (anchorIndex < -1 || anchorIndex >= groups.lastIndex) return null
        val previous = groups.getOrNull(anchorIndex)
        val next = groups.getOrNull(anchorIndex + 1) ?: return null
        val gapStart = previous?.endTimeMs ?: 0L
        val gapEnd = maxOf(gapStart, next.startTimeMs - 250L)
        if (gapEnd - gapStart < 4_000L) return null
        val interlude = AmllInterlude(
            startTimeMs = gapStart,
            endTimeMs = gapEnd,
            anchorGroupIndex = anchorIndex,
            isNextDuet = next.main.isDuet,
        )
        return interlude.takeIf {
            isAmllInterludeActiveAt(it, currentTimeMs)
        }
    }

    return checkGap(currentGroupIndex - 1) ?:
        checkGap(currentGroupIndex) ?:
        checkGap(currentGroupIndex + 1)
}

internal fun buildAmllInterludes(
    groups: List<AmllLyricGroup>,
): List<AmllInterlude> = buildList {
    groups.forEachIndexed { nextGroupIndex, next ->
        val anchorGroupIndex = nextGroupIndex - 1
        val gapStart = groups.getOrNull(anchorGroupIndex)?.endTimeMs ?: 0L
        val gapEnd = maxOf(gapStart, next.startTimeMs - 250L)
        if (gapEnd - gapStart >= 4_000L) {
            add(
                AmllInterlude(
                    startTimeMs = gapStart,
                    endTimeMs = gapEnd,
                    anchorGroupIndex = anchorGroupIndex,
                    isNextDuet = next.main.isDuet,
                ),
            )
        }
    }
}

internal fun findActiveAmllInterlude(
    interludes: List<AmllInterlude>,
    currentTimeMs: Long,
): AmllInterlude? {
    var low = 0
    var high = interludes.lastIndex
    while (low <= high) {
        val middle = (low + high) ushr 1
        val candidate = interludes[middle]
        when {
            currentTimeMs + 20L <= candidate.startTimeMs -> high = middle - 1
            currentTimeMs + 20L >= candidate.endTimeMs -> low = middle + 1
            else -> return candidate
        }
    }
    return null
}

internal fun findAmllInterlude(
    groups: List<AmllLyricGroup>,
    currentTimeMs: Long,
): AmllInterlude? {
    var low = 0
    var high = groups.lastIndex
    var currentGroupIndex = -1
    while (low <= high) {
        val middle = (low + high) ushr 1
        if (groups[middle].startTimeMs <= currentTimeMs) {
            currentGroupIndex = middle
            low = middle + 1
        } else {
            high = middle - 1
        }
    }
    return findAmllInterlude(
        groups = groups,
        currentTimeMs = currentTimeMs,
        currentGroupIndex = currentGroupIndex,
    )
}

internal fun isAmllInterludeActiveAt(
    interlude: AmllInterlude,
    currentTimeMs: Long,
): Boolean {
    val adjustedTime = currentTimeMs + 20L
    return adjustedTime > interlude.startTimeMs &&
        adjustedTime < interlude.endTimeMs
}

/**
 * Matches AMLL's adaptive lyric-position spring.
 *
 * Rapid consecutive lines use a stiffer spring so the focus does not lag
 * behind the audio. Seeking and interludes use the steadier fixed profile.
 */
internal fun amllLineSpringParameters(
    currentStartTimeMs: Long,
    previousStartTimeMs: Long?,
    stabilize: Boolean,
): AmllLineSpringParameters {
    if (stabilize || previousStartTimeMs == null) {
        return AmllLineSpringParameters(stiffness = 90f, damping = 15f)
    }

    val interval = (currentStartTimeMs - previousStartTimeMs).coerceIn(100L, 800L)
    var ratio = 1.0 - (interval - 100L).toDouble() / 700.0
    ratio = ratio.pow(0.2)
    val stiffness = (170.0 + ratio * 50.0).toFloat()
    return AmllLineSpringParameters(
        stiffness = stiffness,
        damping = sqrt(stiffness) * 2.2f,
    )
}
