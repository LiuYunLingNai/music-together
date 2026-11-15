package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** What a deck's audio processors need to know about it; written on the main thread, read on the playback thread. */
internal class DeckState {
    @Volatile
    var active = false

    /** Target [low, mid, high] dB for the transition tone shaping; replaced, never mutated. */
    @Volatile
    var bandDb: FloatArray = AutomixCurves.FLAT
}

private class ToneBand(private val kind: Int, private val hz: Double, channels: Int) {
    var db = 0f
        private set
    private var b0 = 1.0
    private var b1 = 0.0
    private var b2 = 0.0
    private var a1 = 0.0
    private var a2 = 0.0
    private val z1 = DoubleArray(channels)
    private val z2 = DoubleArray(channels)

    fun set(value: Float, sampleRate: Int) {
        db = value
        if (value == 0f) {
            z1.fill(0.0)
            z2.fill(0.0)
            return
        }
        val amplitude = 10.0.pow(value / 40.0)
        val w0 = 2 * PI * min(hz, sampleRate * 0.475) / sampleRate
        val c = cos(w0)
        val root = sqrt(amplitude)
        val a0: Double
        when (kind) {
            LOW_SHELF, HIGH_SHELF -> {
                // The high shelf is the low shelf with the cosine terms mirrored.
                val sign = if (kind == LOW_SHELF) 1.0 else -1.0
                val alpha = sin(w0) / 2 * sqrt(2.0)
                a0 = (amplitude + 1) + sign * (amplitude - 1) * c + 2 * root * alpha
                b0 = amplitude * ((amplitude + 1) - sign * (amplitude - 1) * c + 2 * root * alpha) / a0
                b1 = sign * 2 * amplitude * ((amplitude - 1) - sign * (amplitude + 1) * c) / a0
                b2 = amplitude * ((amplitude + 1) - sign * (amplitude - 1) * c - 2 * root * alpha) / a0
                a1 = -sign * 2 * ((amplitude - 1) + sign * (amplitude + 1) * c) / a0
                a2 = ((amplitude + 1) + sign * (amplitude - 1) * c - 2 * root * alpha) / a0
            }
            else -> {
                val alpha = sin(w0) / (2 * MID_Q)
                a0 = 1 + alpha / amplitude
                b0 = (1 + alpha * amplitude) / a0
                b1 = -2 * c / a0
                b2 = (1 - alpha * amplitude) / a0
                a1 = -2 * c / a0
                a2 = (1 - alpha / amplitude) / a0
            }
        }
    }

    fun process(channel: Int, x: Double): Double {
        val y = b0 * x + z1[channel]
        z1[channel] = b1 * x - a1 * y + z2[channel]
        z2[channel] = b2 * x - a2 * y
        return y
    }

    companion object {
        const val LOW_SHELF = 0
        const val PEAK = 1
        const val HIGH_SHELF = 2
        const val MID_Q = 0.8
    }
}

/** Three-band tone shaping for automix transitions: a low shelf, a mid bell and a high shelf, as the web deck chain. */
@OptIn(markerClass = [UnstableApi::class])
internal class ToneAudioProcessor(private val state: DeckState) : BaseAudioProcessor() {
    private var bands = emptyArray<ToneBand>()

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    override fun onFlush() {
        val channels = inputAudioFormat.channelCount
        bands = arrayOf(
            ToneBand(ToneBand.LOW_SHELF, 250.0, channels),
            ToneBand(ToneBand.PEAK, 1000.0, channels),
            ToneBand(ToneBand.HIGH_SHELF, 4000.0, channels),
        )
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!inputBuffer.hasRemaining()) return
        val target = state.bandDb
        val output = replaceOutputBuffer(inputBuffer.remaining())
        if (bands.indices.all { target[it] == 0f && bands[it].db == 0f }) {
            output.put(inputBuffer)
            output.flip()
            return
        }
        val channels = inputAudioFormat.channelCount
        val sampleRate = inputAudioFormat.sampleRate
        val float = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
        var frames = inputBuffer.remaining() / (channels * if (float) 4 else 2)
        while (frames > 0) {
            val block = min(frames, BLOCK_FRAMES)
            val maxStep = SLEW_DB_PER_SEC * block / sampleRate
            for (index in bands.indices) {
                val band = bands[index]
                val delta = target[index] - band.db
                if (delta != 0f) band.set(band.db + delta.coerceIn(-maxStep, maxStep), sampleRate)
            }
            repeat(block) {
                for (channel in 0 until channels) {
                    var x = if (float) inputBuffer.getFloat().toDouble() else inputBuffer.getShort() / 32768.0
                    for (band in bands) if (band.db != 0f) x = band.process(channel, x)
                    if (float) {
                        output.putFloat(x.toFloat())
                    } else {
                        output.putShort((x * 32768.0).toInt().coerceIn(-32768, 32767).toShort())
                    }
                }
            }
            frames -= block
        }
        output.flip()
    }

    private companion object {
        const val BLOCK_FRAMES = 256
        const val SLEW_DB_PER_SEC = 200f
    }
}
