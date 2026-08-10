package io.github.yueby.musictogether.network

import kotlin.math.roundToLong

internal class DownloadSpeedTracker(
    private val nanoTime: () -> Long = System::nanoTime,
) {
    private var startedAtNanos: Long? = null
    private var startedAtBytes = 0L
    private var sampledAtNanos: Long? = null
    private var sampledBytes = 0L
    private var currentBytesPerSecond: Long? = null

    fun record(downloadedBytes: Long): Long? {
        val bytes = downloadedBytes.coerceAtLeast(0L)
        val now = nanoTime()
        if (startedAtNanos == null || bytes < sampledBytes) {
            startedAtNanos = now
            startedAtBytes = bytes
            sampledAtNanos = now
            sampledBytes = bytes
            currentBytesPerSecond = null
            return null
        }

        val sampleStartedAt = sampledAtNanos ?: now
        val elapsedNanos = now - sampleStartedAt
        if (elapsedNanos >= MIN_SAMPLE_NANOS) {
            currentBytesPerSecond = bytesPerSecond(bytes - sampledBytes, elapsedNanos)
            sampledAtNanos = now
            sampledBytes = bytes
        }
        return currentBytesPerSecond
    }

    fun average(downloadedBytes: Long): Long? {
        val startedAt = startedAtNanos ?: return null
        val elapsedNanos = nanoTime() - startedAt
        return bytesPerSecond(downloadedBytes.coerceAtLeast(startedAtBytes) - startedAtBytes, elapsedNanos)
    }
}

private fun bytesPerSecond(bytes: Long, elapsedNanos: Long): Long? {
    if (bytes <= 0L || elapsedNanos <= 0L) return null
    return (bytes.toDouble() * NANOS_PER_SECOND / elapsedNanos.toDouble()).roundToLong()
}

private const val MIN_SAMPLE_NANOS = 250_000_000L
private const val NANOS_PER_SECOND = 1_000_000_000L
