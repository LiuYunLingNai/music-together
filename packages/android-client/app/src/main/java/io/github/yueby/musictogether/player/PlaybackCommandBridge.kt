package io.github.yueby.musictogether.player

object PlaybackCommandBridge {
    interface Listener {
        fun onTogglePlayback()
        fun onNext()
        fun onPrevious()
    }

    @Volatile
    var listener: Listener? = null

    @Volatile
    var audioFocusEnabled: Boolean = true
        private set

    @Volatile
    var audioFocusListener: ((Boolean) -> Unit)? = null

    @Volatile
    var equalizerEnabled: Boolean = false
        private set

    @Volatile
    var equalizerPreset: Int = 0
        private set

    @Volatile
    var equalizerPresets: List<String> = emptyList()

    @Volatile
    var equalizerListener: ((Boolean, Int) -> Unit)? = null

    fun setEqualizer(enabled: Boolean, preset: Int) {
        equalizerEnabled = enabled
        equalizerPreset = preset
        equalizerListener?.invoke(enabled, preset)
    }

    @Volatile
    internal var tailDeck: TailDeck? = null

    class GainRequest(val linear: Float, val rampSec: Float, val version: Int)

    @Volatile
    var replayGain: GainRequest = GainRequest(1f, 0f, 0)
        private set

    @Synchronized
    fun setReplayGain(linear: Float, rampSec: Float) {
        replayGain = GainRequest(linear, rampSec, replayGain.version + 1)
    }

    fun setAudioFocusEnabled(enabled: Boolean) {
        audioFocusEnabled = enabled
        audioFocusListener?.invoke(enabled)
    }
}
