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

    fun setAudioFocusEnabled(enabled: Boolean) {
        audioFocusEnabled = enabled
        audioFocusListener?.invoke(enabled)
    }
}
