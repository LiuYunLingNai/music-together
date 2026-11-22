package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.PlayState

enum class LocalPlaybackInterruption { SleepTimer, AudioRoute, AudioFocus, WaitingForSync }

internal class LocalPlaybackGate {
    private val reasons = linkedSetOf<LocalPlaybackInterruption>()
    val reason: LocalPlaybackInterruption? get() = reasons.firstOrNull()
    val held: Boolean get() = reasons.isNotEmpty()
    private var generation = 0L
    var resumeToken: Long? = null
        private set
    fun hold(reason: LocalPlaybackInterruption): Boolean = reasons.add(reason)
    fun beginResume() {
        hold(LocalPlaybackInterruption.WaitingForSync)
        resumeToken = ++generation
    }
    fun cancelResume() {
        resumeToken = null
    }
    fun completeResume(token: Long): Boolean {
        if (resumeToken != token) return false
        release()
        return true
    }
    fun release() {
        reasons.clear()
        cancelResume()
    }
}

internal fun roomPlaybackPositionMs(state: PlayState, serverTime: Long): Long {
    val elapsed = if (state.isPlaying && state.serverTimestamp > 0) {
        (serverTime - state.serverTimestamp).coerceAtLeast(0)
    } else 0L
    return ((state.currentTime * 1_000).toLong() + elapsed).coerceAtLeast(0)
}
