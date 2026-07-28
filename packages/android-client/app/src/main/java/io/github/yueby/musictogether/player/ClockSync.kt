package io.github.yueby.musictogether.player

import android.os.SystemClock
import kotlin.math.exp
import kotlin.math.ln

class ClockSync {
    private data class Pending(val elapsed: Long, val wallTime: Long)
    private data class Sample(val rtt: Long, val offset: Double, val recordedAt: Long)

    private val pending = mutableMapOf<Long, Pending>()
    private val samples = ArrayDeque<Sample>()
    private var counter = 0L
    private var anchorElapsed = SystemClock.elapsedRealtime()
    private var anchorServerTime = System.currentTimeMillis().toDouble()

    @get:Synchronized
    val calibrated: Boolean get() = samples.size >= 20
    @get:Synchronized
    val medianRtt: Long
        get() = samples.map { it.rtt }.sorted().let { if (it.isEmpty()) 0 else it[it.size / 2] }

    @Synchronized
    fun recordPing(): Long {
        val now = System.currentTimeMillis()
        val staleBefore = now - 10_000
        val iterator = pending.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().value.wallTime < staleBefore) iterator.remove()
        }
        val id = ++counter
        pending[id] = Pending(SystemClock.elapsedRealtime(), now)
        return id
    }

    @Synchronized
    fun processPong(id: Long, serverTime: Long): Long? {
        val sent = pending.remove(id) ?: return null
        val nowElapsed = SystemClock.elapsedRealtime()
        val rtt = nowElapsed - sent.elapsed
        if (rtt !in 0..10_000) return null
        val offset = serverTime - (sent.wallTime + rtt / 2.0)
        samples.addLast(Sample(rtt, offset, System.currentTimeMillis()))
        while (samples.size > 60) samples.removeFirst()
        val weightedOffset = weightedMedianOffset()
        anchorElapsed = nowElapsed
        anchorServerTime = System.currentTimeMillis() + weightedOffset
        return rtt
    }

    @Synchronized
    fun serverTime(): Long = (anchorServerTime + SystemClock.elapsedRealtime() - anchorElapsed).toLong()

    @Synchronized
    fun reset() {
        pending.clear()
        samples.clear()
        counter = 0
        anchorElapsed = SystemClock.elapsedRealtime()
        anchorServerTime = System.currentTimeMillis().toDouble()
    }

    private fun weightedMedianOffset(): Double {
        val now = System.currentTimeMillis()
        val weighted = samples.map {
            val weight = exp(-((now - it.recordedAt) * ln(2.0)) / 30_000.0)
            it.offset to weight
        }.sortedBy { it.first }
        val half = weighted.sumOf { it.second } / 2.0
        var cumulative = 0.0
        for ((offset, weight) in weighted) {
            cumulative += weight
            if (cumulative >= half) return offset
        }
        return weighted.lastOrNull()?.first ?: 0.0
    }
}
