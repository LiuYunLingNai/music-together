package io.github.yueby.musictogether.player

import kotlin.math.abs
import kotlin.math.max

internal sealed interface DriftCorrection {
    data object None : DriftCorrection
    data class Tempo(val speed: Float) : DriftCorrection
    data class Seek(val positionSeconds: Double) : DriftCorrection
}

/**
 * Filters server timeline samples and chooses a pitch-preserving tempo change
 * or, for a sustained large error, a hard position correction.
 */
internal class PlaybackDriftController {
    private companion object {
        const val DRIFT_DEAD_ZONE_SECONDS = 0.005
        const val DRIFT_TEMPO_GAIN = 0.15
        const val MAX_TEMPO_ADJUSTMENT = 0.01
        const val DRIFT_SEEK_THRESHOLD_SECONDS = 0.5
        const val DRIFT_SEEK_RTT_MARGIN_MS = 250L
        const val EMA_ALPHA = 0.35
        const val HARD_SEEK_CONFIRMATIONS = 2
    }

    private var smoothedDriftSeconds = 0.0
    private var coldStart = true
    private var hardSeekConfirmations = 0

    val currentDriftSeconds: Double
        get() = smoothedDriftSeconds

    fun update(
        currentSeconds: Double,
        expectedSeconds: Double,
        medianRttMs: Long,
        tempoSyncEnabled: Boolean,
    ): DriftCorrection {
        val rawDrift = currentSeconds - expectedSeconds
        smoothedDriftSeconds = if (coldStart) {
            coldStart = false
            rawDrift
        } else {
            EMA_ALPHA * rawDrift + (1 - EMA_ALPHA) * smoothedDriftSeconds
        }

        val absoluteDrift = abs(smoothedDriftSeconds)
        val hardSeekThreshold = max(
            DRIFT_SEEK_THRESHOLD_SECONDS,
            (medianRttMs.coerceAtLeast(0) + DRIFT_SEEK_RTT_MARGIN_MS) / 1000.0,
        )
        if (absoluteDrift > hardSeekThreshold) {
            hardSeekConfirmations++
            if (hardSeekConfirmations < HARD_SEEK_CONFIRMATIONS) return DriftCorrection.None
            reset()
            return DriftCorrection.Seek(expectedSeconds.coerceAtLeast(0.0))
        }

        hardSeekConfirmations = 0
        if (!tempoSyncEnabled || absoluteDrift <= DRIFT_DEAD_ZONE_SECONDS) {
            return DriftCorrection.Tempo(1f)
        }

        val adjustment = (smoothedDriftSeconds * DRIFT_TEMPO_GAIN)
            .coerceIn(-MAX_TEMPO_ADJUSTMENT, MAX_TEMPO_ADJUSTMENT)
        return DriftCorrection.Tempo((1.0 - adjustment).toFloat())
    }

    fun reset() {
        smoothedDriftSeconds = 0.0
        coldStart = true
        hardSeekConfirmations = 0
    }
}
