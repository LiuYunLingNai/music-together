package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import kotlin.math.sqrt

internal data class AmllLyricGroup(
    val main: LyricLine,
    val background: LyricLine? = null,
) {
    val startTimeMs: Long get() = main.startTimeMs
    val endTimeMs: Long get() = main.endTimeMs
}

internal data class AmllInterlude(
    val startTimeMs: Long,
    val endTimeMs: Long,
    val anchorGroupIndex: Int,
    val isNextDuet: Boolean,
)

internal data class AmllWordChunk(
    val words: List<LyricWord>,
) {
    val text: String get() = words.joinToString("") { it.text }
    val startTimeMs: Long get() = words.minOf { it.startTimeMs }
    val endTimeMs: Long get() = words.maxOf { it.endTimeMs }
}

internal data class AmllEmphasisProfile(
    val durationMs: Long,
    val amount: Float,
    val blur: Float,
)

internal data class AmllMeasuredChunk(
    val width: Double,
    val text: String,
    val isSpace: Boolean,
)

internal data class AmllMaskBoundaries(
    val brightEndFraction: Float,
    val fadeEndFraction: Float,
)

internal data class AmllLineSpringParameters(
    val stiffness: Float,
    val damping: Float,
) {
    val composeStiffness: Float
        get() = stiffness / AmllLinePositionMass

    val dampingRatio: Float
        get() = damping / (2f * sqrt(stiffness * AmllLinePositionMass))
}

internal const val AmllLinePositionMass = 0.9f

/**
 * Kotlin port of AMLL core's default optimizeLyricLines pipeline.
 *
 * The input remains untouched. The returned groups use the same main-line +
 * optional following background-line structure as AMLL's LyricLineGroup.
 */
