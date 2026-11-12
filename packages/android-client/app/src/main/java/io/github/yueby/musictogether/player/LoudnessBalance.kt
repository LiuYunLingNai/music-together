package io.github.yueby.musictogether.player

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.min

/** Loudness-balance decisions, ported from the web client's `balanceRules` (file reading and typical guess only). */
internal object LoudnessBalance {
    const val TARGET_LUFS = -14.0
    const val MAX_BOOST_DB = 6.0
    const val PEAK_CEILING_DB = -1.5
    const val TYPICAL_SIZE = 20
    const val TYPICAL_FALLBACK_DB = -5.0
    const val EARLY_MOVE_SEC = 10.0
    const val EARLY_RAMP_SEC = 2f
    const val LATE_MOVE_SEC = 30.0
    const val LATE_RAMP_SEC = 5f
    const val LATE_MIN_CUT_DB = 3.0
    const val SET_RAMP_SEC = 0.1f
    private const val SAME_GAIN_DB = 0.05

    sealed interface Move {
        data object Set : Move
        data class Ramp(val seconds: Float) : Move
    }

    fun liftWithinPeak(gainDb: Double, peak: Double?): Double {
        if (gainDb <= 0) return gainDb
        if (peak == null || peak <= 0) return 0.0
        val headroomDb = PEAK_CEILING_DB - 20 * log10(peak)
        return min(min(gainDb, MAX_BOOST_DB), headroomDb.coerceAtLeast(0.0))
    }

    fun typicalGainDb(history: List<Double>): Double {
        val recent = history.takeLast(TYPICAL_SIZE).filter { it.isFinite() }.sorted()
        if (recent.isEmpty()) return TYPICAL_FALLBACK_DB
        val middle = recent.size / 2
        val median = if (recent.size % 2 == 1) recent[middle] else (recent[middle - 1] + recent[middle]) / 2
        return min(0.0, median)
    }

    /** Gain in dB for the `auto` mode: the measured reading when there is one, otherwise a cautious typical cut. */
    fun autoGainDb(info: LoudnessInfo?, history: List<Double>): Double {
        if (info != null && info.lufs > LoudnessMeter.SILENCE_LUFS) {
            return liftWithinPeak(TARGET_LUFS - info.lufs, info.peak)
        }
        return min(0.0, typicalGainDb(history))
    }

    /** Gain in dB for the `track` mode. */
    fun trackGainDb(info: LoudnessInfo?): Double {
        if (info == null) return 0.0
        var db = (TARGET_LUFS - info.lufs).coerceIn(-12.0, 6.0)
        if (db > 0 && info.peak > 0) db = min(db, -20 * log10(info.peak))
        return db
    }

    /** What a better reading may do to a song that is already playing; null means leave it for the next play. */
    fun planMove(playSec: Double, moved: Boolean, currentDb: Double, nextDb: Double): Move? {
        if (abs(nextDb - currentDb) < SAME_GAIN_DB) return null
        if (playSec <= 0) return Move.Set
        if (moved) return null
        val ramp = when {
            playSec < EARLY_MOVE_SEC -> EARLY_RAMP_SEC
            playSec < LATE_MOVE_SEC && nextDb <= currentDb - LATE_MIN_CUT_DB -> LATE_RAMP_SEC
            else -> return null
        }
        return Move.Ramp(ramp)
    }
}
