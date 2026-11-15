package io.github.yueby.musictogether.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

/** The measurement maths behind a track profile, ported from the web client's `signalAnalysis`. */
internal object SignalAnalysis {
    const val SILENCE_DB = -90.0
    const val LUFS_OFFSET_DB = -0.691
    const val BEATS_PER_BAR = 4
    private const val MIN_BPM = 60
    private const val MAX_BPM = 180
    private const val TEMPO_HARMONICS = 4
    private const val PHASE_BEATS = 96
    private const val DOWNBEAT_WINDOW_BARS = 24
    private const val ABSOLUTE_GATE_LUFS = -70.0
    private const val RELATIVE_GATE_LU = 10.0

    /** JavaScript's `Math.round`, which the ported index arithmetic depends on. */
    fun round(value: Double): Int = floor(value + 0.5).toInt()

    private val bitReversal = HashMap<Int, IntArray>()

    private fun bitReversalOf(n: Int): IntArray = synchronized(bitReversal) {
        bitReversal.getOrPut(n) {
            val table = IntArray(n)
            var j = 0
            for (i in 1 until n) {
                var bit = n shr 1
                while (j and bit != 0) {
                    j = j xor bit
                    bit = bit shr 1
                }
                j = j xor bit
                table[i] = j
            }
            table
        }
    }

    /** Iterative radix-2 FFT, in place. */
    fun fft(real: DoubleArray, imag: DoubleArray) {
        val n = real.size
        val reversed = bitReversalOf(n)
        for (i in 1 until n) {
            val j = reversed[i]
            if (i < j) {
                var swap = real[i]
                real[i] = real[j]
                real[j] = swap
                swap = imag[i]
                imag[i] = imag[j]
                imag[j] = swap
            }
        }
        var len = 2
        while (len <= n) {
            val angle = -2 * PI / len
            val wReal = cos(angle)
            val wImag = sin(angle)
            val half = len / 2
            var i = 0
            while (i < n) {
                var curReal = 1.0
                var curImag = 0.0
                for (k in 0 until half) {
                    val aReal = real[i + k]
                    val aImag = imag[i + k]
                    val bReal = real[i + k + half] * curReal - imag[i + k + half] * curImag
                    val bImag = real[i + k + half] * curImag + imag[i + k + half] * curReal
                    real[i + k] = aReal + bReal
                    imag[i + k] = aImag + bImag
                    real[i + k + half] = aReal - bReal
                    imag[i + k + half] = aImag - bImag
                    val nextReal = curReal * wReal - curImag * wImag
                    curImag = curReal * wImag + curImag * wReal
                    curReal = nextReal
                }
                i += len
            }
            len = len shl 1
        }
    }

    /** How much energy appeared since the previous frame; only rises count. */
    fun spectralFlux(current: FloatArray, previous: FloatArray, bins: Int): Double {
        var flux = 0.0
        for (index in 0 until min(bins, current.size)) {
            if (current[index] > previous[index]) flux += current[index] - previous[index]
        }
        return flux
    }

    class Tempo(val bpm: Double, val periodSec: Double, val beatOffsetHops: Int)

    private fun tempoPrior(bpm: Double) = exp(-0.5 * (ln(bpm / 120) / ln(2.0) / 0.55).pow(2))

    /** Tempo and beat phase from an onset-strength envelope, by harmonic-summed autocorrelation. */
    fun estimateTempo(envelope: DoubleArray, hopSec: Double): Tempo? {
        if (hopSec <= 0) return null
        val count = envelope.size
        val minLag = max(2, round(60 / (MAX_BPM * hopSec)))
        val maxLag = round(60 / (MIN_BPM * hopSec))
        if (count < maxLag * 3) return null

        val mean = envelope.sum() / count
        val centred = DoubleArray(count)
        var energy = 0.0
        for (index in 0 until count) {
            val value = max(0.0, envelope[index] - mean)
            centred[index] = value
            energy += value * value
        }
        if (energy <= 0) return null

        val topLag = min(count / 3, maxLag * TEMPO_HARMONICS)
        val correlation = DoubleArray(topLag + 1)
        for (lag in minLag..topLag) {
            var sum = 0.0
            for (index in lag until count) sum += centred[index] * centred[index - lag]
            correlation[lag] = sum / (count - lag)
        }

        var bestLag = 0
        var bestScore = 0.0
        var scoreSum = 0.0
        var scored = 0
        for (lag in minLag..maxLag) {
            var sum = 0.0
            for (harmonic in 1..TEMPO_HARMONICS) {
                val at = lag * harmonic
                if (at > topLag) break
                sum += correlation[at] / harmonic
            }
            val score = sum * tempoPrior(60 / (lag * hopSec))
            scoreSum += score
            scored += 1
            if (score > bestScore) {
                bestScore = score
                bestLag = lag
            }
        }
        val average = if (scored > 0) scoreSum / scored else 0.0
        if (bestLag == 0 || bestScore <= 0 || average <= 0) return null

        // The period to a fraction of a hop: a parabola through the peak, read at the highest multiple that has one.
        var period = bestLag.toDouble()
        for (harmonic in TEMPO_HARMONICS downTo 1) {
            val centre = bestLag * harmonic
            if (centre + 1 > topLag) continue
            var peak = centre
            for (at in max(minLag + 1, centre - harmonic)..min(topLag - 1, centre + harmonic)) {
                if (correlation[at] > correlation[peak]) peak = at
            }
            if (peak <= minLag || peak >= topLag) continue
            val before = correlation[peak - 1]
            val after = correlation[peak + 1]
            val curve = before - 2 * correlation[peak] + after
            if (!(curve < 0)) continue
            val refined = (peak + (before - after) / (2 * curve)) / harmonic
            if (abs(refined - bestLag) <= 0.5) {
                period = refined
                break
            }
        }

        var beatOffsetHops = 0
        var bestPhase = -1.0
        for (offset in 0 until bestLag) {
            var sum = 0.0
            for (beat in 0 until PHASE_BEATS) {
                val index = round(count - 1 - offset - beat * period)
                if (index < 0) break
                sum += centred[index]
            }
            if (sum > bestPhase) {
                bestPhase = sum
                beatOffsetHops = offset
            }
        }
        return Tempo(60 / (period * hopSec), period * hopSec, beatOffsetHops)
    }

    /** K-weighting as two biquads, derived for the caller's sample rate. */
    class KWeight(sampleRate: Int) {
        private val b0: Double
        private val b1: Double
        private val b2: Double
        private val a0: Double
        private val a1: Double
        private val c0: Double
        private val c1: Double
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0
        private var p1 = 0.0
        private var p2 = 0.0
        private var q1 = 0.0
        private var q2 = 0.0

        init {
            val shelfQ = 0.7071752369554196
            val k1 = tan(PI * 1681.974450955533 / sampleRate)
            val vh = 10.0.pow(3.999843853973347 / 20)
            val vb = vh.pow(0.4996667741545416)
            val d0 = 1 + k1 / shelfQ + k1 * k1
            b0 = (vh + vb * k1 / shelfQ + k1 * k1) / d0
            b1 = 2 * (k1 * k1 - vh) / d0
            b2 = (vh - vb * k1 / shelfQ + k1 * k1) / d0
            a0 = 2 * (k1 * k1 - 1) / d0
            a1 = (1 - k1 / shelfQ + k1 * k1) / d0
            val hpQ = 0.5003270373238773
            val k2 = tan(PI * 38.13547087602444 / sampleRate)
            val d1 = 1 + k2 / hpQ + k2 * k2
            c0 = 2 * (k2 * k2 - 1) / d1
            c1 = (1 - k2 / hpQ + k2 * k2) / d1
        }

        fun step(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a0 * y1 - a1 * y2
            x2 = x1
            x1 = x
            y2 = y1
            y1 = y
            val z = y - 2 * p1 + p2 - c0 * q1 - c1 * q2
            p2 = p1
            p1 = y
            q2 = q1
            q1 = z
            return z
        }
    }

    /** BS.1770 integrated loudness from mean K-weighted power per 100 ms (both channels summed). */
    fun gatedLoudness(steps: DoubleArray): Double {
        val blocks = DoubleArray(max(0, steps.size - 3)) {
            (steps[it] + steps[it + 1] + steps[it + 2] + steps[it + 3]) / 4
        }
        fun lufs(power: Double) = LUFS_OFFSET_DB + 10 * log10(power)
        fun meanAbove(gate: Double): Double {
            var sum = 0.0
            var count = 0
            for (block in blocks) {
                if (block > 0 && lufs(block) > gate) {
                    sum += block
                    count += 1
                }
            }
            return if (count > 0) sum / count else 0.0
        }
        val audible = meanAbove(ABSOLUTE_GATE_LUFS)
        if (!(audible > 0)) return SILENCE_DB
        return lufs(meanAbove(max(ABSOLUTE_GATE_LUFS, lufs(audible) - RELATIVE_GATE_LU)))
    }

    private class PhaseVote(val phase: Int, val contrast: Double)

    /** Which phase of the bar an evidence envelope puts its weight on, or null when it cannot tell. */
    private fun votePhase(envelope: DoubleArray, hopSec: Double, periodSec: Double, beatOffsetSec: Double): PhaseVote? {
        val radius = max(1, round(periodSec / hopSec / 8))
        val span = envelope.size * hopSec
        val barSec = periodSec * BEATS_PER_BAR
        val scores = DoubleArray(BEATS_PER_BAR)
        for (phase in 0 until BEATS_PER_BAR) {
            val hits = ArrayList<Double>()
            val first = beatOffsetSec + phase * periodSec
            val bars = floor((span - first) / barSec).toInt() + 1
            for (bar in max(0, bars - DOWNBEAT_WINDOW_BARS) until bars) {
                val centre = round((first + bar * barSec) / hopSec)
                if (centre < 0 || centre >= envelope.size) continue
                var peak = envelope[centre]
                for (index in max(0, centre - radius)..min(envelope.size - 1, centre + radius)) {
                    if (envelope[index] > peak) peak = envelope[index]
                }
                hits += peak
            }
            hits.sort()
            scores[phase] = if (hits.isEmpty()) 0.0 else hits[hits.size shr 1]
        }
        var best = 0
        for (phase in 1 until BEATS_PER_BAR) if (scores[phase] > scores[best]) best = phase
        val mean = scores.sum() / scores.size

        val windowStart = min(envelope.size - 1, max(0, round((span - DOWNBEAT_WINDOW_BARS * barSec) / hopSec)))
        var floorLevel = 0.0
        for (index in windowStart until envelope.size) floorLevel += envelope[index]
        floorLevel /= envelope.size - windowStart
        if (!(mean > 0) || scores[best] < mean * 1.25 || scores[best] < floorLevel * 1.5) return null
        return PhaseVote(best, scores[best] / mean)
    }

    /** Seconds from the start of the envelope to a downbeat: the kick or the harmony, whichever is clearer. */
    fun estimateDownbeat(
        lowEnvelope: DoubleArray,
        hopSec: Double,
        periodSec: Double,
        beatOffsetSec: Double,
        harmonicEnvelope: DoubleArray,
    ): Double? {
        if (hopSec <= 0 || periodSec <= 0 || lowEnvelope.size < BEATS_PER_BAR * 4) return null
        val kick = votePhase(lowEnvelope, hopSec, periodSec, beatOffsetSec)
        val harmony = if (harmonicEnvelope.size >= BEATS_PER_BAR * 4) {
            votePhase(harmonicEnvelope, hopSec, periodSec, beatOffsetSec)
        } else {
            null
        }
        val winner = when {
            kick == null -> harmony
            harmony == null -> kick
            harmony.contrast > kick.contrast -> harmony
            else -> kick
        } ?: return null
        val barSec = periodSec * BEATS_PER_BAR
        return ((beatOffsetSec + winner.phase * periodSec) % barSec + barSec) % barSec
    }
}
