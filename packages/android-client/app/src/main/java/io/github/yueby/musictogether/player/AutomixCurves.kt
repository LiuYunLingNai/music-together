package io.github.yueby.musictogether.player

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** The blend shapes the web client schedules for a transition, evaluated at one point through the overlap. */
internal object AutomixCurves {
    private const val HEADROOM_DB = 1.5
    private const val BASS_KILL_DB = 24.0
    private const val SWEEP_OUT_HIGH_DB = 9.0
    private const val BASS_SWAP_WIDTH = 0.12
    private const val MAX_TILT_DB = 3.0
    val FLAT = floatArrayOf(0f, 0f, 0f)

    /** Equal-power gains (outgoing, incoming); `together` holds both at one level around the crossover. */
    fun gains(progress: Double, crossover: Double, together: Double): Pair<Float, Float> {
        val p = progress.coerceIn(0.0, 1.0)
        val pivot = crossover.coerceIn(0.15, 0.85)
        val held = together.coerceIn(0.0, 0.8)
        val lead = pivot * (1 - held)
        val trail = pivot + (1 - pivot) * held
        val warped = when {
            p <= lead -> p / max(1e-3, lead) * 0.5
            p >= trail -> 0.5 + (p - trail) / max(1e-3, 1 - trail) * 0.5
            else -> 0.5
        }
        val angle = warped * PI / 2
        val headroom = 10.0.pow(-HEADROOM_DB * sin(p * PI) / 20)
        return (cos(angle) * headroom).toFloat() to (sin(angle) * headroom).toFloat()
    }

    /** Per-deck [low, mid, high] dB (outgoing, incoming): the low end changes hands at the crossover. */
    fun bands(
        progress: Double,
        crossover: Double,
        sweepOut: Boolean,
        tiltMidDb: Double,
        tiltHighDb: Double,
    ): Pair<FloatArray, FloatArray> {
        val p = progress.coerceIn(0.0, 1.0)
        val seam = crossover.coerceIn(0.15, 0.85)
        val width = max(0.02, min(BASS_SWAP_WIDTH, min(seam, 1 - seam)))
        val handover = ((p - (seam - width / 2)) / width).coerceIn(0.0, 1.0)
        val leaving = ((p - seam) / max(1e-3, 1 - seam)).coerceIn(0.0, 1.0).pow(2)
        val settling = (1 - p / max(1e-3, seam)).coerceIn(0.0, 1.0)
        val out = floatArrayOf(
            (-BASS_KILL_DB * handover).toFloat(),
            0f,
            if (sweepOut) (-SWEEP_OUT_HIGH_DB * leaving).toFloat() else 0f,
        )
        val incoming = floatArrayOf(
            (-BASS_KILL_DB * (1 - handover)).toFloat(),
            (tiltMidDb.coerceIn(-MAX_TILT_DB, MAX_TILT_DB) * settling).toFloat(),
            (tiltHighDb.coerceIn(-MAX_TILT_DB, MAX_TILT_DB) * settling).toFloat(),
        )
        return out to incoming
    }
}
