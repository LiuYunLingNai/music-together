package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/** Applies the loudness-balance gain (with an optional ramp) to the PCM the player outputs. */
@OptIn(markerClass = [UnstableApi::class])
internal class GainAudioProcessor(private val deck: DeckState) : BaseAudioProcessor() {
    private var wasActive = false
    private var current = 1f
    private var target = 1f
    private var step = 0f
    private var remainingFrames = 0
    private var seenVersion = -1

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        // The pipeline also calls with its shared empty buffer, which is what an unused output buffer is too.
        if (!inputBuffer.hasRemaining()) return
        val request = PlaybackCommandBridge.replayGain
        // The gain belongs to the session's song: an outgoing tail keeps the one it had.
        val active = deck.active
        if (active && request.version != seenVersion) {
            seenVersion = request.version
            target = request.linear
            val frames = if (wasActive) (request.rampSec * inputAudioFormat.sampleRate).toInt() else 0
            if (frames <= 0) {
                current = target
                remainingFrames = 0
            } else {
                step = (target - current) / frames
                remainingFrames = frames
            }
        }
        wasActive = active
        val output = replaceOutputBuffer(inputBuffer.remaining())
        if (current == 1f && remainingFrames == 0) {
            output.put(inputBuffer)
        } else {
            val channels = inputAudioFormat.channelCount
            val float = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
            while (inputBuffer.hasRemaining()) {
                repeat(channels) {
                    if (float) {
                        output.putFloat((inputBuffer.getFloat() * current).coerceIn(-1f, 1f))
                    } else {
                        output.putShort((inputBuffer.getShort() * current).toInt().coerceIn(-32768, 32767).toShort())
                    }
                }
                if (remainingFrames > 0) {
                    remainingFrames--
                    current = if (remainingFrames == 0) target else current + step
                }
            }
        }
        output.flip()
    }
}
