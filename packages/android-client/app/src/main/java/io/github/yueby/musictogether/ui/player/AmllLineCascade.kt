package io.github.yueby.musictogether.ui.player

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

private const val CascadeBaseDelaySec = 0.05f
private const val CascadeDelayDecay = 1.05f
private const val CascadeSettleSec = 3f

/** How far a spring released from 1 with no velocity still is from rest after [seconds]. */
internal fun amllSpringRemaining(seconds: Float, stiffness: Float, dampingRatio: Float): Float {
    if (seconds <= 0f) return 1f
    val omega = sqrt(stiffness)
    val zeta = dampingRatio.coerceIn(0.05f, 1f)
    val decay = exp(-zeta * omega * seconds)
    if (zeta >= 0.999f) return decay * (1f + omega * seconds)
    val damped = omega * sqrt(1f - zeta * zeta)
    return decay * (cos(damped * seconds) + zeta * omega / damped * sin(damped * seconds))
}

/** AMLL calcLayout stagger: on-screen lines start one after another, the gap shrinking past the target line. */
internal fun amllCascadeDelay(index: Int, firstIndex: Int, targetIndex: Int): Float {
    var delay = 0f
    var step = CascadeBaseDelaySec
    for (line in firstIndex until index) {
        delay += step
        if (line >= targetIndex) step /= CascadeDelayDecay
    }
    return delay
}

/**
 * AMLL moves every lyric line on its own spring, each starting a little after the one above. The list here
 * scrolls in one step instead, so each line is drawn displaced by the distance it has not yet travelled.
 */
internal class AmllLineCascade {
    private class Impulse(
        val distance: Float,
        val startNanos: Long,
        val firstIndex: Int,
        val targetIndex: Int,
        val stiffness: Float,
        val dampingRatio: Float,
    )

    private val impulses = mutableStateListOf<Impulse>()
    private var frameNanos by mutableLongStateOf(0L)

    fun push(
        distance: Float,
        nowNanos: Long,
        firstIndex: Int,
        targetIndex: Int,
        stiffness: Float,
        dampingRatio: Float,
    ) {
        frameNanos = max(frameNanos, nowNanos)
        impulses += Impulse(distance, nowNanos, firstIndex, targetIndex, stiffness, dampingRatio)
    }

    fun clear() = impulses.clear()

    fun offsetFor(index: Int): Float {
        val now = frameNanos
        var offset = 0f
        for (impulse in impulses) {
            val seconds = (now - impulse.startNanos) / 1_000_000_000f -
                amllCascadeDelay(index, impulse.firstIndex, impulse.targetIndex)
            offset += impulse.distance * amllSpringRemaining(seconds, impulse.stiffness, impulse.dampingRatio)
        }
        return offset
    }

    suspend fun run() {
        snapshotFlow { impulses.isNotEmpty() }.collectLatest { active ->
            if (!active) return@collectLatest
            while (true) {
                withFrameNanos { now ->
                    frameNanos = now
                    impulses.removeAll { (now - it.startNanos) / 1_000_000_000f > CascadeSettleSec }
                }
            }
        }
    }
}
