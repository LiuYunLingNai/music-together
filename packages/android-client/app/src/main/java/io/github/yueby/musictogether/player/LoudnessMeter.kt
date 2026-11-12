package io.github.yueby.musictogether.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaDataSource
import android.media.MediaFormat
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

internal data class LoudnessInfo(val lufs: Double, val peak: Double)

private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
    var z1 = 0.0
    var z2 = 0.0

    fun process(x: Double): Double {
        val y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }

    fun copy() = Biquad(b0, b1, b2, a1, a2)
}

private fun highShelf(sampleRate: Double): Biquad {
    val amplitude = 10.0.pow(3.999843853973347 / 40)
    val w0 = 2 * PI * 1681.974450955533 / sampleRate
    val alpha = sin(w0) / 2 * sqrt(2.0)
    val sqrtA = sqrt(amplitude)
    val c = cos(w0)
    val b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * c + 2 * sqrtA * alpha)
    val b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * c)
    val b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * c - 2 * sqrtA * alpha)
    val a0 = (amplitude + 1) - (amplitude - 1) * c + 2 * sqrtA * alpha
    val a1 = 2 * ((amplitude - 1) - (amplitude + 1) * c)
    val a2 = (amplitude + 1) - (amplitude - 1) * c - 2 * sqrtA * alpha
    return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

private fun highPass(sampleRate: Double): Biquad {
    val w0 = 2 * PI * 38.13547087602444 / sampleRate
    val c = cos(w0)
    val alpha = sin(w0) / (2 * 0.5003270373238773)
    val a0 = 1 + alpha
    return Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0)
}

/** EBU R128 integrated loudness (K-weighting, 400 ms windows, -70 LUFS and -10 LU gates), as the web client measures it. */
internal class LoudnessMeter(private val sampleRate: Int, private val channels: Int) {
    private val blockSize = (sampleRate * 0.1).toInt().coerceAtLeast(1)
    private val shelves = Array(channels) { highShelf(sampleRate.toDouble()) }
    private val passes = Array(channels) { highPass(sampleRate.toDouble()) }
    private val blockSums = ArrayList<Double>()
    private val blockCounts = ArrayList<Int>()
    private var frameInBlock = 0
    private var sum = 0.0
    private var peak = 0.0

    fun addFrame(frame: DoubleArray) {
        for (channel in 0 until channels) {
            val x = frame[channel]
            if (abs(x) > peak) peak = abs(x)
            val v = passes[channel].process(shelves[channel].process(x))
            sum += v * v
        }
        if (++frameInBlock == blockSize) closeBlock()
    }

    private fun closeBlock() {
        blockSums += sum
        blockCounts += frameInBlock
        sum = 0.0
        frameInBlock = 0
    }

    fun finish(): LoudnessInfo? {
        if (frameInBlock > 0) closeBlock()
        val powers = ArrayList<Double>()
        for (block in 0..blockSums.size - 4) {
            var s = 0.0
            var n = 0
            for (offset in 0 until 4) {
                s += blockSums[block + offset]
                n += blockCounts[block + offset]
            }
            if (n > 0) powers += s / n
        }
        if (powers.isEmpty()) return null
        val aboveAbsolute = powers.filter { loudnessOf(it) > -70.0 }
        if (aboveAbsolute.isEmpty()) return LoudnessInfo(SILENCE_LUFS, peak)
        val threshold = loudnessOf(aboveAbsolute.average()) - 10.0
        val gated = aboveAbsolute.filter { loudnessOf(it) > threshold }.ifEmpty { aboveAbsolute }
        return LoudnessInfo(loudnessOf(gated.average()), peak)
    }

    private fun loudnessOf(power: Double) = -0.691 + 10 * log10(power)

    companion object {
        const val SILENCE_LUFS = -150.0
    }
}

internal object LoudnessAnalyzer {
    /** Decodes the whole song and measures it; returns null when it cannot be decoded. */
    fun measure(source: MediaDataSource, isActive: () -> Boolean): LoudnessInfo? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(source)
            val index = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            extractor.selectTrack(index)
            val inputFormat = extractor.getTrackFormat(index)
            val decoder = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME)!!)
            codec = decoder
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var float = false
            var meter = LoudnessMeter(sampleRate, channels)
            var frame = DoubleArray(channels)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            while (!outputDone) {
                if (!isActive()) return null
                if (!inputDone) {
                    val inputIndex = decoder.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inputIndex)!!
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0) {
                            decoder.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)
                when {
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val format = decoder.outputFormat
                        val newRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        val newChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        float = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                        if (newRate != sampleRate || newChannels != channels) {
                            sampleRate = newRate
                            channels = newChannels
                            meter = LoudnessMeter(sampleRate, channels)
                            frame = DoubleArray(channels)
                        }
                    }
                    outputIndex >= 0 -> {
                        val buffer = decoder.getOutputBuffer(outputIndex)!!.order(ByteOrder.nativeOrder())
                        buffer.position(info.offset).limit(info.offset + info.size)
                        while (buffer.remaining() >= channels * if (float) 4 else 2) {
                            for (c in 0 until channels) {
                                frame[c] = if (float) buffer.getFloat().toDouble() else buffer.getShort() / 32768.0
                            }
                            meter.addFrame(frame)
                        }
                        decoder.releaseOutputBuffer(outputIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
            return meter.finish()
        } catch (_: Exception) {
            return null
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            extractor.release()
            runCatching { source.close() }
        }
    }
}
