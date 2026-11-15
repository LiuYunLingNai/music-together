package io.github.yueby.musictogether.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaDataSource
import android.media.MediaExtractor
import android.media.MediaFormat
import org.json.JSONObject
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Receives a decoded song one frame (one sample per channel) at a time. */
internal interface PcmSink {
    /** Called before the first frame, and again if the decoder changes format, which starts the song over. */
    fun format(sampleRate: Int, channels: Int)

    fun frame(frame: DoubleArray)
}

internal object PcmDecoder {
    /** Decodes the whole song into the sinks in one pass; false when it could not be decoded or was cancelled. */
    fun decode(source: MediaDataSource, isActive: () -> Boolean, sinks: List<PcmSink>): Boolean {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(source)
            val index = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return false
            extractor.selectTrack(index)
            val inputFormat = extractor.getTrackFormat(index)
            val decoder = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME)!!)
            codec = decoder
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var float = false
            var frame = DoubleArray(channels)
            sinks.forEach { it.format(sampleRate, channels) }
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            while (true) {
                if (!isActive()) return false
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
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val format = decoder.outputFormat
                    val newRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    val newChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    float = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    if (newRate != sampleRate || newChannels != channels) {
                        sampleRate = newRate
                        channels = newChannels
                        frame = DoubleArray(channels)
                        sinks.forEach { it.format(sampleRate, channels) }
                    }
                } else if (outputIndex >= 0) {
                    val buffer = decoder.getOutputBuffer(outputIndex)!!.order(ByteOrder.nativeOrder())
                    buffer.position(info.offset).limit(info.offset + info.size)
                    while (buffer.remaining() >= channels * if (float) 4 else 2) {
                        for (c in 0 until channels) {
                            frame[c] = if (float) buffer.getFloat().toDouble() else buffer.getShort() / 32768.0
                        }
                        for (sink in sinks) sink.frame(frame)
                    }
                    decoder.releaseOutputBuffer(outputIndex, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
            }
        } catch (_: Exception) {
            return false
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            extractor.release()
            runCatching { source.close() }
        }
    }
}

internal class LoudnessSink : PcmSink {
    private var meter: LoudnessMeter? = null

    override fun format(sampleRate: Int, channels: Int) {
        meter = LoudnessMeter(sampleRate, channels)
    }

    override fun frame(frame: DoubleArray) {
        meter?.addFrame(frame)
    }

    fun result(): LoudnessInfo? = meter?.finish()
}

/**
 * Brings a song to the profile's analysis rate as mid and side, with a windowed-sinc polyphase filter: one
 * coefficient row per output phase, so the standard rates cost a table lookup per tap.
 */
internal class MidSideResampler(inRate: Int, outRate: Int, private val emit: (Float, Float) -> Unit) {
    private val up: Int
    private val down: Int
    private val half: Int
    private val table: Array<FloatArray>
    private val mask: Int
    private val mid: FloatArray
    private val side: FloatArray
    private var received = 0L
    private var nextNumerator = 0L

    init {
        val divisor = gcd(inRate, outRate)
        up = outRate / divisor
        down = inRate / divisor
        require(up <= MAX_PHASES) { "unsupported sample rate $inRate" }
        val cutoff = 0.5 * min(1.0, up.toDouble() / down) * 0.95
        half = ceil(ZERO_CROSSINGS / (2 * cutoff)).toInt()
        table = Array(up) { phase ->
            val row = FloatArray(half * 2)
            var sum = 0.0
            for (tap in row.indices) {
                val distance = tap - half + 1 - phase.toDouble() / up
                val x = 2 * cutoff * distance
                val sinc = if (x == 0.0) 1.0 else sin(PI * x) / (PI * x)
                val reach = distance / half
                val shape = 0.42 + 0.5 * cos(PI * reach) + 0.08 * cos(2 * PI * reach)
                val value = sinc * shape
                row[tap] = value.toFloat()
                sum += value
            }
            for (tap in row.indices) row[tap] = (row[tap] / sum).toFloat()
            row
        }
        var capacity = 1
        while (capacity < half * 2 + 1) capacity = capacity shl 1
        mask = capacity - 1
        mid = FloatArray(capacity)
        side = FloatArray(capacity)
    }

    fun add(midSample: Float, sideSample: Float) {
        val index = received++
        mid[(index and mask.toLong()).toInt()] = midSample
        side[(index and mask.toLong()).toInt()] = sideSample
        // An output is ready once the newest input it reads has arrived.
        while (nextNumerator / up + half <= index) {
            val base = nextNumerator / up
            val row = table[(nextNumerator % up).toInt()]
            var m = 0f
            var s = 0f
            val start = base - half + 1
            for (tap in row.indices) {
                val at = start + tap
                if (at < 0) continue
                val slot = (at and mask.toLong()).toInt()
                m += mid[slot] * row[tap]
                s += side[slot] * row[tap]
            }
            emit(m, s)
            nextNumerator += down
        }
    }

    /** Pushes the filter's tail through so the last half window of the song is not lost. */
    fun flush() {
        repeat(half) { add(0f, 0f) }
    }

    private companion object {
        const val ZERO_CROSSINGS = 10
        const val MAX_PHASES = 1024

        tailrec fun gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)
    }
}

/** Measures a track profile from the decoded song; a clip that is not the whole song yields nothing. */
internal class ProfileSink(private val statedDurationSec: Double) : PcmSink {
    private var builder: TrackProfileBuilder? = null
    private var resampler: MidSideResampler? = null
    private var stereo = false

    override fun format(sampleRate: Int, channels: Int) {
        stereo = channels > 1
        val next = TrackProfileBuilder(TrackProfileBuilder.PROFILE_SAMPLE_RATE, stereo)
        builder = next
        resampler = runCatching {
            MidSideResampler(sampleRate, TrackProfileBuilder.PROFILE_SAMPLE_RATE) { mid, side -> next.add(mid, side) }
        }.getOrNull()
    }

    override fun frame(frame: DoubleArray) {
        val left = frame[0]
        val right = if (stereo) frame[1] else left
        resampler?.add(((left + right) / 2).toFloat(), ((left - right) / 2).toFloat())
    }

    fun result(): JSONObject? {
        val active = resampler ?: return null
        active.flush()
        val profile = builder?.finish() ?: return null
        // A preview clip plays fine but must never stand for the song.
        if (statedDurationSec > 0 && profile.getDouble("duration") / statedDurationSec < NOT_THE_SONG_SHARE) return null
        return profile
    }

    private companion object {
        const val NOT_THE_SONG_SHARE = 0.5
    }
}
