package io.github.yueby.musictogether.player

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

private class DoubleList {
    private var values = DoubleArray(4096)
    var size = 0
        private set

    fun add(value: Double) {
        if (size == values.size) values = values.copyOf(size * 2)
        values[size++] = value
    }

    fun toArray(): DoubleArray = values.copyOf(size)
}

internal class KeyEstimate(val key: Int, val major: Boolean, val confidence: Double)

internal class TrackEdges(
    val leadIn: Double,
    val soundingEnd: Double,
    val bodyEnd: Double,
    val startsHot: Boolean,
    val endsHot: Boolean,
    val introSlope: Double,
    val outroSlope: Double,
    val loudness: Double,
    val headDb: Double,
    val tailDb: Double,
)

/**
 * What the server's transition planner needs to know about a song, measured from its audio. A port of the web
 * client's `analyseTrack` without the neural beat grid (`gridless`), fed one sample at a time so a whole song
 * never sits in memory.
 */
internal class TrackProfileBuilder(private val sampleRate: Int, private val stereo: Boolean) {
    private val hopSec = HOP.toDouble() / sampleRate
    private val bins = FFT_SIZE / 2
    private val binHz = sampleRate.toDouble() / FFT_SIZE
    private val fluxBins = max(8, SignalAnalysis.round(FLUX_CEILING_HZ / binHz))
    private val lowFluxBins = max(4, SignalAnalysis.round(DOWNBEAT_CEILING_HZ / binHz))
    private val toneEdgeLow = min(bins, SignalAnalysis.round(250 / binHz))
    private val toneEdgeHigh = min(bins, SignalAnalysis.round(4000 / binHz))
    private val vocalLowBin = max(1, floor(VOCAL_LOW_HZ / binHz).toInt())
    private val vocalHighBin = min(bins - 1, ceil(VOCAL_HIGH_HZ / binHz).toInt())
    private val window = DoubleArray(FFT_SIZE) { 0.5 - 0.5 * cos(2 * PI * it / (FFT_SIZE - 1)) }
    private val binPitchClass = IntArray(bins) {
        val hz = it * binHz
        if (hz >= CHROMA_MIN_HZ && hz <= CHROMA_MAX_HZ) {
            ((SignalAnalysis.round(12 * ln(hz / 440) / ln(2.0) + 69) % 12) + 12) % 12
        } else {
            -1
        }
    }
    private val chromaBins = (0 until bins).filter { binPitchClass[it] >= 0 }.toIntArray()

    private val monoFrame = FloatArray(FFT_SIZE)
    private val sideFrame = FloatArray(FFT_SIZE)
    private val weightedFrame = FloatArray(FFT_SIZE)
    private var filled = 0
    private var samples = 0L
    private var frames = 0

    private val levelWeight = SignalAnalysis.KWeight(sampleRate)
    private val leftWeight = SignalAnalysis.KWeight(sampleRate)
    private val rightWeight = SignalAnalysis.KWeight(sampleRate)
    private val stepLength = SignalAnalysis.round(sampleRate / 10.0)
    private val loudnessSteps = DoubleList()
    private var stepPower = 0.0
    private var stepFilled = 0
    private var peak = 0.0

    private val real = DoubleArray(FFT_SIZE)
    private val imag = DoubleArray(FFT_SIZE)
    private val magnitudes = DoubleArray(bins)
    private val spectrum = FloatArray(bins)
    private val previous = FloatArray(bins)
    private val frameChroma = DoubleArray(12)
    private val previousChroma = DoubleArray(12)
    private val chroma = DoubleArray(12)
    private val sectionBins = ArrayList<DoubleArray>()
    private val toneBins = ArrayList<DoubleArray>()
    private val levels = DoubleList()
    private val envelope = DoubleList()
    private val lowEnvelope = DoubleList()
    private val chromaEnvelope = DoubleList()
    private val centre = DoubleList()

    fun add(mid: Float, side: Float) {
        val left = (mid + side).toDouble()
        val right = (mid - side).toDouble()
        peak = max(peak, max(abs(left), abs(right)))
        val wl = leftWeight.step(left)
        val wr = rightWeight.step(right)
        stepPower += wl * wl + wr * wr
        if (++stepFilled == stepLength) {
            loudnessSteps.add(stepPower / stepLength)
            stepPower = 0.0
            stepFilled = 0
        }

        monoFrame[filled] = mid
        sideFrame[filled] = side
        weightedFrame[filled] = levelWeight.step(mid.toDouble()).toFloat()
        samples += 1
        if (++filled == FFT_SIZE) {
            analyseFrame()
            System.arraycopy(monoFrame, HOP, monoFrame, 0, FFT_SIZE - HOP)
            System.arraycopy(sideFrame, HOP, sideFrame, 0, FFT_SIZE - HOP)
            System.arraycopy(weightedFrame, HOP, weightedFrame, 0, FFT_SIZE - HOP)
            filled = FFT_SIZE - HOP
        }
    }

    private fun analyseFrame() {
        var square = 0.0
        for (value in weightedFrame) square += value * value
        val rms = sqrt(square / FFT_SIZE)
        levels.add(if (rms > 0) max(SignalAnalysis.SILENCE_DB, 20 * log10(rms)) else SignalAnalysis.SILENCE_DB)

        for (index in 0 until FFT_SIZE) {
            real[index] = monoFrame[index] * window[index]
            imag[index] = 0.0
        }
        SignalAnalysis.fft(real, imag)

        val binIndex = (frames.toLong() * HOP / sampleRate).toInt()
        while (sectionBins.size <= binIndex) {
            sectionBins += DoubleArray(12)
            toneBins += DoubleArray(3)
        }
        val sectionBin = sectionBins[binIndex]
        val toneBin = toneBins[binIndex]

        var midBand = 0.0
        var framePeak = 0.0
        for (index in 0 until bins) {
            val magnitude = hypot(real[index], imag[index])
            magnitudes[index] = magnitude
            spectrum[index] = if (magnitude > 0) {
                max(SignalAnalysis.SILENCE_DB, 20 * log10(magnitude)).toFloat()
            } else {
                SignalAnalysis.SILENCE_DB.toFloat()
            }
            val power = magnitude * magnitude
            when {
                index < toneEdgeLow -> toneBin[0] += power
                index < toneEdgeHigh -> toneBin[1] += power
                else -> toneBin[2] += power
            }
            if (index in vocalLowBin..vocalHighBin) midBand += power
            if (binPitchClass[index] >= 0 && magnitude > framePeak) framePeak = magnitude
        }

        // Spectral flatness over the chroma range: broadband frames (drums) count for less of the harmony.
        val floorLevel = framePeak * 1e-3
        var arithmetic = 0.0
        var logSum = 0.0
        for (index in chromaBins) {
            val magnitude = max(magnitudes[index], floorLevel)
            arithmetic += magnitude
            logSum += ln(magnitude)
        }
        val flatness = if (arithmetic > 0 && chromaBins.isNotEmpty()) {
            exp(logSum / chromaBins.size) / (arithmetic / chromaBins.size)
        } else {
            1.0
        }
        val tonality = max(0.0, 1 - flatness / CHROMA_MAX_FLATNESS)
        frameChroma.fill(0.0)
        if (tonality > 0) {
            for (index in chromaBins) {
                val contribution = magnitudes[index] * tonality
                val pitchClass = binPitchClass[index]
                chroma[pitchClass] += contribution
                sectionBin[pitchClass] += contribution
                frameChroma[pitchClass] += contribution
            }
        }

        var harmonicChange = 0.0
        val chromaSum = frameChroma.sum()
        if (chromaSum > 0) {
            for (pitchClass in 0 until 12) {
                val share = frameChroma[pitchClass] / chromaSum
                harmonicChange += max(0.0, share - previousChroma[pitchClass])
                frameChroma[pitchClass] = share
            }
            frameChroma.copyInto(previousChroma)
        }

        if (stereo) {
            for (index in 0 until FFT_SIZE) {
                real[index] = sideFrame[index] * window[index]
                imag[index] = 0.0
            }
            SignalAnalysis.fft(real, imag)
            var sideBand = 0.0
            for (index in vocalLowBin..vocalHighBin) sideBand += real[index] * real[index] + imag[index] * imag[index]
            val total = midBand + sideBand
            centre.add(if (total > 0) midBand / total else 0.5)
        }

        if (frames > 0) {
            envelope.add(SignalAnalysis.spectralFlux(spectrum, previous, fluxBins))
            lowEnvelope.add(SignalAnalysis.spectralFlux(spectrum, previous, lowFluxBins))
            chromaEnvelope.add(harmonicChange)
        }
        spectrum.copyInto(previous)
        frames += 1
    }

    /** The profile as the `player:track_profile` payload, or null when there was nothing to measure. */
    fun finish(): JSONObject? {
        val duration = samples.toDouble() / sampleRate
        if (!(duration > 1)) return null
        val edges = measureEdges(levels.toArray(), hopSec, FFT_SIZE.toDouble() / sampleRate) ?: return null

        val flux = envelope.toArray()
        val lowFlux = lowEnvelope.toArray()
        val harmonicFlux = chromaEnvelope.toArray()
        val tempo = SignalAnalysis.estimateTempo(flux, hopSec)
        val envelopeStartSec = FFT_SIZE / (2.0 * sampleRate)
        val beatOffset = if (tempo != null && tempo.periodSec > 0) {
            modulo((flux.size - 1 - tempo.beatOffsetHops) * hopSec + envelopeStartSec, tempo.periodSec)
        } else {
            0.0
        }
        val barSec = if (tempo != null) tempo.periodSec * SignalAnalysis.BEATS_PER_BAR else 0.0
        val downbeat = if (tempo != null && barSec > 0) {
            SignalAnalysis.estimateDownbeat(
                lowFlux,
                hopSec,
                tempo.periodSec,
                modulo(beatOffset - envelopeStartSec, tempo.periodSec),
                harmonicFlux,
            )
        } else {
            null
        }

        val tempoFrames = SignalAnalysis.round(OUTRO_TEMPO_SEC / hopSec)
        val outroTempo = if (flux.size <= tempoFrames) {
            null
        } else {
            SignalAnalysis.estimateTempo(flux.copyOfRange(flux.size - tempoFrames, flux.size), hopSec)
        }
        val headTempo = if (tempo != null && flux.size > tempoFrames) {
            SignalAnalysis.estimateTempo(flux.copyOfRange(0, tempoFrames), hopSec)
        } else {
            null
        }
        val headDownbeat = if (tempo != null && headTempo != null &&
            abs(headTempo.periodSec / tempo.periodSec - 1) <= HEAD_TEMPO_TOLERANCE
        ) {
            SignalAnalysis.estimateDownbeat(
                lowFlux.copyOfRange(0, tempoFrames),
                hopSec,
                headTempo.periodSec,
                modulo((tempoFrames - 1 - headTempo.beatOffsetHops) * hopSec, headTempo.periodSec),
                harmonicFlux.copyOfRange(0, tempoFrames),
            )
        } else {
            null
        }

        val binCount = max(1, ceil(duration / NOVELTY_BIN_SEC).toInt())
        while (sectionBins.size < binCount) {
            sectionBins += DoubleArray(12)
            toneBins += DoubleArray(3)
        }
        val firstBin = max(0, floor(edges.leadIn / NOVELTY_BIN_SEC).toInt())
        val lastBin = min(binCount, ceil(edges.soundingEnd / NOVELTY_BIN_SEC).toInt())
        fun keyOver(from: Int, to: Int): KeyEstimate {
            val total = DoubleArray(12)
            for (bin in max(0, from) until min(binCount, to)) {
                for (pitchClass in 0 until 12) total[pitchClass] += sectionBins[bin][pitchClass]
            }
            return keyFromChroma(total)
        }
        fun toneOver(from: Int, to: Int): JSONArray {
            val total = DoubleArray(3)
            for (bin in max(0, from) until min(binCount, to)) {
                for (band in 0 until 3) total[band] += toneBins[bin][band]
            }
            val all = total.sum()
            return JSONArray().apply { for (value in total) put(if (all > 0) value / all else 1.0 / 3) }
        }
        fun keyJson(estimate: KeyEstimate) = JSONObject()
            .put("key", max(0, estimate.key))
            .put("major", estimate.major)
            .put("confidence", if (estimate.key < 0) 0.0 else estimate.confidence)

        val key = keyFromChroma(chroma)
        val sections = findBoundaries(sectionBins.subList(0, binCount), NOVELTY_BIN_SEC).take(256)
        val steps = loudnessSteps.toArray()
        val measuredProgram = samples >= stepLength * 4L
        val vocalStart = if (stereo) firstSustained(centre.toArray(), hopSec) else null

        fun finite(value: Double, low: Double, high: Double) = (if (value.isFinite()) value else 0.0).coerceIn(low, high)
        fun nullable(value: Double?): Any = value?.takeIf { it.isFinite() && it >= 0 } ?: JSONObject.NULL
        return JSONObject()
            .put("version", TRACK_PROFILE_VERSION)
            .put("partial", false)
            .put("gridless", true)
            .put("duration", duration)
            .put("leadIn", finite(edges.leadIn, 0.0, 600.0))
            .put("vocalStart", nullable(vocalStart))
            .put("sectionStart", nullable(sections.firstOrNull()))
            .put("sections", JSONArray().apply { sections.forEach { put(max(0.0, it)) } })
            .put("leadOut", finite(duration - edges.soundingEnd, 0.0, 600.0))
            .put("bodyOut", finite(duration - edges.bodyEnd, 0.0, duration))
            .put("startsHot", edges.startsHot)
            .put("endsHot", edges.endsHot)
            .put("introSlope", finite(edges.introSlope, -240.0, 240.0))
            .put("outroSlope", finite(edges.outroSlope, -240.0, 240.0))
            .put("loudness", finite(edges.loudness, -150.0, 12.0))
            .put("programLoudness", if (measuredProgram) finite(SignalAnalysis.gatedLoudness(steps), -150.0, 12.0) else JSONObject.NULL)
            .put("peak", if (measuredProgram) finite(peak, 0.0, 100.0) else JSONObject.NULL)
            .put("headDb", finite(edges.headDb, -150.0, 12.0))
            .put("tailDb", finite(edges.tailDb, -150.0, 12.0))
            .put("introTone", toneOver(firstBin, firstBin + EDGE_WINDOW_SEC))
            .put("outroTone", toneOver(lastBin - EDGE_WINDOW_SEC, lastBin))
            .put("bpm", nullable(tempo?.bpm))
            .put("outroBpm", nullable(outroTempo?.bpm))
            .put("beatOffset", finite(beatOffset, 0.0, duration))
            .put("downbeatOffset", nullable(downbeat?.let { modulo(it + envelopeStartSec, barSec) }))
            .put("headDownbeatOffset", nullable(headDownbeat?.let { modulo(it + envelopeStartSec, barSec) }))
            .put("beatsPerBar", SignalAnalysis.BEATS_PER_BAR)
            .put("key", max(0, key.key))
            .put("major", key.major)
            .put("keyConfidence", if (key.key < 0) 0.0 else key.confidence)
            .put("introKey", keyJson(keyOver(firstBin, firstBin + ENDPOINT_CHROMA_SEC)))
            .put("outroKey", keyJson(keyOver(lastBin - ENDPOINT_CHROMA_SEC, lastBin)))
    }

    companion object {
        /** Matches the web client's profile version, so the server treats both as the same measurement. */
        const val TRACK_PROFILE_VERSION = 10
        const val PROFILE_SAMPLE_RATE = 22050
        private const val FFT_SIZE = 2048
        private const val HOP = 512
        private const val FLUX_CEILING_HZ = 5000.0
        private const val CHROMA_MIN_HZ = 65.0
        private const val CHROMA_MAX_HZ = 2000.0
        private const val SILENCE_BELOW_PEAK_DB = 40.0
        private const val EDGE_WINDOW_SEC = 10
        private const val HOT_WINDOW_SEC = 1.5
        private const val HOT_EDGE_DB = 6.0
        private const val VOCAL_LOW_HZ = 300.0
        private const val VOCAL_HIGH_HZ = 3400.0
        private const val VOCAL_MIN_SEC = 0.8
        private const val VOCAL_SMOOTH_SEC = 0.5
        private const val VOCAL_RISE = 0.5
        private const val DOWNBEAT_CEILING_HZ = 150.0
        private const val ENDPOINT_CHROMA_SEC = 20
        private const val OUTRO_TEMPO_SEC = 30.0
        private const val HEAD_TEMPO_TOLERANCE = 0.1
        private const val CHROMA_MAX_FLATNESS = 0.28
        private const val NOVELTY_BIN_SEC = 1.0
        private const val NOVELTY_HALF_KERNEL = 4
        private const val NOVELTY_MIN_KERNEL = 2
        private const val NOVELTY_MIN_SEC = 2.0
        private const val NOVELTY_SIGMAS = 1.0

        private val MAJOR_PROFILE = doubleArrayOf(6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
        private val MINOR_PROFILE = doubleArrayOf(6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

        private fun modulo(value: Double, span: Double) = ((value % span) + span) % span

        private fun correlate(a: DoubleArray, b: DoubleArray): Double {
            val meanA = a.average()
            val meanB = b.average()
            var top = 0.0
            var leftSq = 0.0
            var rightSq = 0.0
            for (index in a.indices) {
                val left = a[index] - meanA
                val right = b[index] - meanB
                top += left * right
                leftSq += left * left
                rightSq += right * right
            }
            return if (leftSq > 0 && rightSq > 0) top / sqrt(leftSq * rightSq) else 0.0
        }

        /** Krumhansl-Schmuckler: the best-correlating key for a 12-bin chroma vector, and how clearly it won. */
        fun keyFromChroma(chroma: DoubleArray): KeyEstimate {
            var bestKey = -1
            var bestMajor = true
            var bestScore = Double.NEGATIVE_INFINITY
            var runnerUp = Double.NEGATIVE_INFINITY
            for (rotation in 0 until 12) {
                val rotated = DoubleArray(12) { chroma[(it + rotation) % 12] }
                for (major in booleanArrayOf(true, false)) {
                    val score = correlate(rotated, if (major) MAJOR_PROFILE else MINOR_PROFILE)
                    if (score > bestScore) {
                        runnerUp = bestScore
                        bestKey = rotation
                        bestMajor = major
                        bestScore = score
                    } else if (score > runnerUp) {
                        runnerUp = score
                    }
                }
            }
            if (bestKey < 0 || !bestScore.isFinite() || bestScore <= 0) return KeyEstimate(-1, true, 0.0)
            val margin = if (runnerUp.isFinite()) max(0.0, bestScore - runnerUp) else 0.0
            return KeyEstimate(bestKey, bestMajor, min(1.0, max(0.0, bestScore) * min(1.0, margin / 0.15)))
        }

        private fun smooth(values: DoubleArray, window: Int): DoubleArray {
            val half = max(0, window / 2)
            if (half == 0) return values
            val prefix = DoubleArray(values.size + 1)
            for (index in values.indices) prefix[index + 1] = prefix[index] + values[index]
            return DoubleArray(values.size) {
                val from = max(0, it - half)
                val to = min(values.size, it + half + 1)
                (prefix[to] - prefix[from]) / (to - from)
            }
        }

        /** Where a centred sound in the vocal band first holds: the singing starting, as far as audio can tell. */
        private fun firstSustained(centre: DoubleArray, hopSec: Double): Double? {
            if (centre.isEmpty()) return null
            val curve = smooth(centre, SignalAnalysis.round(VOCAL_SMOOTH_SEC / hopSec))
            val low = curve.min()
            val high = curve.max()
            if (!(high - low > 0.02)) return null
            val threshold = low + (high - low) * VOCAL_RISE
            val needed = max(1, SignalAnalysis.round(VOCAL_MIN_SEC / hopSec))
            var run = 0
            for (index in curve.indices) {
                if (curve[index] <= threshold) {
                    run = 0
                    continue
                }
                run += 1
                if (run >= needed) return (index - run + 1) * hopSec
            }
            return null
        }

        /** Section boundaries by Foote novelty over the per-second chroma self-similarity. */
        private fun findBoundaries(bins: List<DoubleArray>, binSec: Double): List<Double> {
            val half = NOVELTY_HALF_KERNEL
            if (bins.size < half * 2 + 3) return emptyList()
            val unit = bins.map { bin ->
                val energy = bin.sumOf { it * it }
                val scale = if (energy > 0) 1 / sqrt(energy) else 0.0
                DoubleArray(12) { bin[it] * scale }
            }
            fun similarity(a: Int, b: Int): Double {
                var dot = 0.0
                for (index in 0 until 12) dot += unit[a][index] * unit[b][index]
                return dot
            }
            val novelty = DoubleArray(bins.size)
            val first = NOVELTY_MIN_KERNEL
            val last = bins.size - 1 - NOVELTY_MIN_KERNEL
            for (centre in first..last) {
                val reach = min(half, min(centre, bins.size - 1 - centre))
                var score = 0.0
                var mass = 0.0
                for (a in -reach until reach) {
                    for (b in -reach until reach) {
                        val sign = if ((a < 0) == (b < 0)) 1 else -1
                        val taper = exp(-(a * a + b * b) / (2 * (half / 2.0).pow(2)))
                        score += sign * taper * similarity(centre + a, centre + b)
                        mass += taper
                    }
                }
                novelty[centre] = if (mass > 0) score / mass else 0.0
            }
            val scored = novelty.copyOfRange(half, bins.size - half)
            if (scored.max() - scored.min() < 1e-6) return emptyList()
            val mean = scored.average()
            val variance = scored.sumOf { (it - mean).pow(2) } / scored.size
            val threshold = mean + NOVELTY_SIGMAS * sqrt(variance)
            fun lean(index: Int): Double {
                val left = novelty[index - 1]
                val right = novelty[index + 1]
                val curve = left - 2 * novelty[index] + right
                if (!(abs(curve) > 1e-12)) return 0.0
                return ((left - right) / (2 * curve)).coerceIn(-0.5, 0.5)
            }
            val earliest = max(first + 1, ceil(NOVELTY_MIN_SEC / binSec).toInt())
            val boundaries = ArrayList<Double>()
            for (index in earliest until last) {
                val isPeak = novelty[index] > novelty[index - 1] && novelty[index] >= novelty[index + 1]
                if (isPeak && novelty[index] > threshold) boundaries += (index + lean(index)) * binSec
            }
            return boundaries
        }

        private fun slopePerSec(values: DoubleArray, hopSec: Double): Double {
            val count = values.size
            if (count < 2) return 0.0
            val meanX = (count - 1) / 2.0
            val meanY = values.average()
            var top = 0.0
            var bottom = 0.0
            for (index in 0 until count) {
                val dx = index - meanX
                top += dx * (values[index] - meanY)
                bottom += dx * dx
            }
            return if (bottom > 0) top / bottom / hopSec else 0.0
        }

        /** Everything about a track's two ends, from a series of K-weighted frame levels in dBFS. */
        fun measureEdges(levels: DoubleArray, hopSec: Double, frameSec: Double): TrackEdges? {
            if (levels.isEmpty() || hopSec <= 0) return null
            val peak = levels.max()
            if (peak <= SignalAnalysis.SILENCE_DB) return null
            val floorLevel = peak - SILENCE_BELOW_PEAK_DB
            val first = levels.indexOfFirst { it > floorLevel }
            val last = levels.indexOfLast { it > floorLevel }
            if (first < 0 || last < first) return null

            val sounding = levels.copyOfRange(first, last + 1)
            val edgeFrames = max(2, SignalAnalysis.round(EDGE_WINDOW_SEC / hopSec))
            val hotFrames = max(2, SignalAnalysis.round(HOT_WINDOW_SEC / hopSec))
            val average = sounding.average()
            fun head(frames: Int) = sounding.copyOfRange(0, min(frames, sounding.size))
            fun tail(frames: Int) = sounding.copyOfRange(max(0, sounding.size - frames), sounding.size)

            val prefix = DoubleArray(sounding.size + 1)
            for (index in sounding.indices) prefix[index + 1] = prefix[index] + sounding[index]
            fun holdsLevelAt(endExclusive: Int): Boolean {
                val from = max(0, endExclusive - hotFrames)
                return (prefix[endExclusive] - prefix[from]) / (endExclusive - from) > average - HOT_EDGE_DB
            }
            var body = sounding.size
            while (body > 1 && !holdsLevelAt(body)) body -= 1

            var energy = 0.0
            var counted = 0
            for (level in levels) {
                if (level <= SignalAnalysis.SILENCE_DB) continue
                energy += 10.0.pow(level / 10)
                counted += 1
            }
            fun integrated(values: DoubleArray): Double {
                if (values.isEmpty()) return SignalAnalysis.SILENCE_DB
                val sum = values.sumOf { 10.0.pow(it / 10) }
                return max(SignalAnalysis.SILENCE_DB, 10 * log10(sum / values.size) + SignalAnalysis.LUFS_OFFSET_DB)
            }
            return TrackEdges(
                leadIn = first * hopSec,
                soundingEnd = last * hopSec + frameSec,
                bodyEnd = max(0.0, (first + body - 1) * hopSec + frameSec),
                startsHot = head(hotFrames).average() > average - HOT_EDGE_DB,
                endsHot = tail(hotFrames).average() > average - HOT_EDGE_DB,
                introSlope = slopePerSec(head(edgeFrames), hopSec),
                outroSlope = slopePerSec(tail(edgeFrames), hopSec),
                loudness = if (counted > 0) {
                    10 * log10(energy / counted) + SignalAnalysis.LUFS_OFFSET_DB
                } else {
                    SignalAnalysis.SILENCE_DB
                },
                headDb = integrated(head(edgeFrames)),
                tailDb = integrated(tail(edgeFrames)),
            )
        }
    }
}
