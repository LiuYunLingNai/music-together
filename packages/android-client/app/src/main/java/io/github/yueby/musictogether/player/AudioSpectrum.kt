package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Passive spectrum tap: the playback service inserts [sink] through a pass-through
 * [TeeAudioProcessor], so audio output is never modified. Analysis only runs while a
 * visible spectrum control bar has set [enabled].
 *
 * [latest] mirrors web `AnalyserNode.getByteFrequencyData` over 80-2000 Hz (0..255 per bin,
 * smoothingTimeConstant 0.8, -100..-30 dB), which is what the web classic stage draws.
 */
@OptIn(markerClass = [UnstableApi::class])
object AudioSpectrum {
    private const val FftSize = 2048
    private const val FrameIntervalMs = 16L
    private const val MinHz = 80.0
    private const val MaxHz = 2_000.0
    private const val Smoothing = 0.8f
    private const val MinDb = -100f
    private const val MaxDb = -30f
    private val Empty = FloatArray(0)

    @Volatile
    var enabled: Boolean = false
        set(value) {
            field = value
            if (!value) latest = Empty
        }

    @Volatile
    var latest: FloatArray = Empty
        private set

    val sink: TeeAudioProcessor.AudioBufferSink = object : TeeAudioProcessor.AudioBufferSink {
        private var sampleRate = 44_100
        private var channels = 2
        private var encoding = C.ENCODING_PCM_16BIT
        private val ring = FloatArray(FftSize)
        private var writeIndex = 0
        private var filled = 0
        private var lastEmit = 0L
        private val re = FloatArray(FftSize)
        private val im = FloatArray(FftSize)
        private val smoothed = FloatArray(FftSize / 2)
        private val window = FloatArray(FftSize) { (0.5 - 0.5 * cos(2.0 * PI * it / (FftSize - 1))).toFloat() }

        override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
            sampleRate = sampleRateHz.coerceAtLeast(1)
            channels = channelCount.coerceAtLeast(1)
            this.encoding = encoding
            writeIndex = 0
            filled = 0
            smoothed.fill(0f)
        }

        override fun handleBuffer(buffer: ByteBuffer) {
            if (!enabled) return
            val data = buffer.duplicate().order(ByteOrder.nativeOrder())
            val bytesPerSample = when (encoding) {
                C.ENCODING_PCM_16BIT -> 2
                C.ENCODING_PCM_FLOAT -> 4
                else -> return
            }
            val frameBytes = bytesPerSample * channels
            while (data.remaining() >= frameBytes) {
                var sum = 0f
                repeat(channels) {
                    sum += if (bytesPerSample == 2) data.short / 32768f else data.float
                }
                ring[writeIndex] = sum / channels
                writeIndex = (writeIndex + 1) % FftSize
                if (filled < FftSize) filled++
            }
            if (filled < FftSize) return
            val now = SystemClock.elapsedRealtime()
            if (now - lastEmit < FrameIntervalMs) return
            lastEmit = now
            analyse()
        }

        private fun analyse() {
            for (i in 0 until FftSize) {
                re[i] = ring[(writeIndex + i) % FftSize] * window[i]
                im[i] = 0f
            }
            fft(re, im)
            val binHz = sampleRate.toDouble() / FftSize
            val from = floor(MinHz / binHz).toInt().coerceAtLeast(1)
            val to = ceil(MaxHz / binHz).toInt().coerceAtMost(FftSize / 2)
            if (to <= from) return
            val out = FloatArray(to - from)
            for (bin in from until to) {
                val magnitude = sqrt(re[bin] * re[bin] + im[bin] * im[bin]) / FftSize
                smoothed[bin] = Smoothing * smoothed[bin] + (1f - Smoothing) * magnitude
                val db = 20f * log10(smoothed[bin].coerceAtLeast(1e-9f))
                out[bin - from] = (255f * (db - MinDb) / (MaxDb - MinDb)).coerceIn(0f, 255f)
            }
            latest = out
        }
    }

    private fun fft(re: FloatArray, im: FloatArray) {
        val n = re.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                re[i] = re[j].also { re[j] = re[i] }
                im[i] = im[j].also { im[j] = im[i] }
            }
        }
        var length = 2
        while (length <= n) {
            val angle = -2.0 * PI / length
            val wRe = cos(angle).toFloat()
            val wIm = sin(angle).toFloat()
            var start = 0
            while (start < n) {
                var curRe = 1f
                var curIm = 0f
                for (k in 0 until length / 2) {
                    val a = start + k
                    val b = a + length / 2
                    val tRe = re[b] * curRe - im[b] * curIm
                    val tIm = re[b] * curIm + im[b] * curRe
                    re[b] = re[a] - tRe
                    im[b] = im[a] - tIm
                    re[a] += tRe
                    im[a] += tIm
                    val nextRe = curRe * wRe - curIm * wIm
                    curIm = curRe * wIm + curIm * wRe
                    curRe = nextRe
                }
                start += length
            }
            length = length shl 1
        }
    }
}
