package io.github.yueby.musictogether.player

import android.content.Context
import android.media.AudioManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.nio.ByteBuffer

/** Feeds the visualiser from whichever deck currently owns the session. */
@OptIn(markerClass = [UnstableApi::class])
private class DeckSpectrumSink(private val state: DeckState) : TeeAudioProcessor.AudioBufferSink {
    private var sampleRate = 0
    private var channels = 0
    private var encoding = 0
    private var forwarding = false

    override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        sampleRate = sampleRateHz
        channels = channelCount
        this.encoding = encoding
        forwarding = state.active
        if (forwarding) AudioSpectrum.sink.flush(sampleRateHz, channelCount, encoding)
    }

    override fun handleBuffer(buffer: ByteBuffer) {
        if (!state.active) {
            forwarding = false
            return
        }
        if (!forwarding) {
            forwarding = true
            AudioSpectrum.sink.flush(sampleRate, channels, encoding)
        }
        AudioSpectrum.sink.handleBuffer(buffer)
    }
}

/**
 * Two identical players. One owns the media session; for an automix transition the session moves to the other
 * while the first keeps playing the outgoing song untouched, so the handover has no seam to hide.
 */
@OptIn(markerClass = [UnstableApi::class])
internal class PlaybackDecks(private val context: Context, private val onHandOver: (Player) -> Unit) {
    class Deck(val player: ExoPlayer, val state: DeckState) {
        val sessionPlayer: Player = RoomMediaSessionPlayer(player)
    }

    private val decks = List(2) { build() }
    private var attributes: AudioAttributes = AudioAttributes.DEFAULT
    private var handleFocus = false

    var active: Deck = decks[0]
        private set
    private val tail: Deck get() = decks.first { it !== active }

    val audioSessionIds: List<Int> get() = decks.map { it.player.audioSessionId }

    /**
     * Two players created together ask for their session ids at the same moment, and the platform can fail one
     * request while it is still connecting to the audio service. That player then cannot open an audio track at
     * all, so an invalid id is replaced before it is used.
     */
    fun repairAudioSessions(): Boolean {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return false
        var repaired = false
        for (deck in decks) {
            if (deck.player.audioSessionId != AudioManager.ERROR) continue
            val fresh = audioManager.generateAudioSessionId()
            if (fresh == AudioManager.ERROR) continue
            deck.player.audioSessionId = fresh
            repaired = true
        }
        return repaired
    }

    init {
        active.state.active = true
    }

    private fun build(): Deck {
        val state = DeckState()
        val renderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
            ): AudioSink = DefaultAudioSink.Builder(context)
                .setEnableFloatOutput(enableFloatOutput)
                .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                .setAudioProcessors(
                    arrayOf(
                        GainAudioProcessor(state),
                        ToneAudioProcessor(state),
                        TeeAudioProcessor(DeckSpectrumSink(state)),
                    ),
                )
                .build()
        }
        val player = ExoPlayer.Builder(context, renderersFactory)
            .setMediaSourceFactory(DefaultMediaSourceFactory(PlaybackCache.playbackFactory(context)))
            .build()
        return Deck(player, state)
    }

    fun configureAudioFocus(attributes: AudioAttributes, enabled: Boolean) {
        this.attributes = attributes
        handleFocus = enabled
        active.player.setAudioAttributes(attributes, enabled)
        tail.player.setAudioAttributes(attributes, false)
    }

    /** The playing song stays on its deck as the tail; the other deck, silent and empty, takes the session. */
    fun handOver() {
        val outgoing = active
        val incoming = tail
        repairAudioSessions()
        incoming.player.stop()
        incoming.player.clearMediaItems()
        incoming.player.volume = 0f
        incoming.state.bandDb = AutomixCurves.FLAT
        // Two focus owners in one app would take focus from each other; only the session's deck asks for it.
        outgoing.player.setAudioAttributes(attributes, false)
        outgoing.player.volume = 1f
        outgoing.player.playbackParameters = PlaybackParameters.DEFAULT
        outgoing.state.active = false
        incoming.state.active = true
        active = incoming
        incoming.player.setAudioAttributes(attributes, handleFocus)
        onHandOver(incoming.sessionPlayer)
    }

    fun setTailSpeed(speed: Float) {
        tail.player.playbackParameters = PlaybackParameters(speed, 1f)
    }

    fun blend(tailVolume: Float, tailBands: FloatArray, activeBands: FloatArray) {
        tail.player.volume = tailVolume.coerceIn(0f, 1f)
        tail.state.bandDb = tailBands
        active.state.bandDb = activeBands
    }

    fun stopTail() {
        tail.player.stop()
        tail.player.clearMediaItems()
        tail.state.bandDb = AutomixCurves.FLAT
        active.state.bandDb = AutomixCurves.FLAT
    }

    fun release() {
        decks.forEach { it.player.release() }
    }
}
