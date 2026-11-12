package io.github.yueby.musictogether.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/** Applies the loudness-balance gain (with an optional ramp) to the PCM the player outputs. */
@OptIn(markerClass = [UnstableApi::class])
internal class GainAudioProcessor : BaseAudioProcessor() {
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
        val request = PlaybackCommandBridge.replayGain
        if (request.version != seenVersion) {
            seenVersion = request.version
            target = request.linear
            val frames = (request.rampSec * inputAudioFormat.sampleRate).toInt()
            if (frames <= 0) {
                current = target
                remainingFrames = 0
            } else {
                step = (target - current) / frames
                remainingFrames = frames
            }
        }
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
