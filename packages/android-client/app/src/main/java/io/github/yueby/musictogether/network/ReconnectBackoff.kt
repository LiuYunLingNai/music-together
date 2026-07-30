package io.github.yueby.musictogether.network

internal data class ReconnectAttempt(
    val number: Int,
    val delayMs: Long,
)

/**
 * Bounds automatic primary-server reconnects while spacing repeated failures
 * far enough apart to avoid continuously waking the device and server.
 */
internal class ReconnectBackoff(
    private val delaysMs: List<Long> = DEFAULT_DELAYS_MS,
) {
    private var nextAttemptIndex = 0

    init {
        require(delaysMs.isNotEmpty())
        require(delaysMs.all { it > 0L })
    }

    val maxAttempts: Int
        get() = delaysMs.size

    fun nextAttempt(): ReconnectAttempt? {
        val delayMs = delaysMs.getOrNull(nextAttemptIndex) ?: return null
        nextAttemptIndex += 1
        return ReconnectAttempt(number = nextAttemptIndex, delayMs = delayMs)
    }

    fun reset() {
        nextAttemptIndex = 0
    }

    private companion object {
        val DEFAULT_DELAYS_MS = listOf(2_000L, 4_000L, 8_000L, 15_000L, 30_000L)
    }
}
