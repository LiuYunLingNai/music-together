package io.github.yueby.musictogether.player

object PlaybackCommandBridge {
    interface Listener {
        fun onTogglePlayback()
        fun onNext()
        fun onPrevious()
    }

    @Volatile
    var listener: Listener? = null
}
