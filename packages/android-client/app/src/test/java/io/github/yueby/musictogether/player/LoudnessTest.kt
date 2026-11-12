package io.github.yueby.musictogether.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue

class LoudnessTest {
    @Test
    fun stereoSineMeasuresNearItsLevel() {
        val rate = 48_000
        val meter = LoudnessMeter(rate, 2)
        val frame = DoubleArray(2)
        repeat(rate * 10) { n ->
            val v = 0.1 * sin(2 * PI * 1000 * n / rate)
            frame[0] = v
            frame[1] = v
            meter.addFrame(frame)
        }
        val info = meter.finish()!!
        assertTrue("lufs=${info.lufs}", abs(info.lufs - -20.0) < 1.5)
        assertEquals(0.1, info.peak, 0.001)
    }

    @Test
    fun balanceLiftsQuietSongsOnlyWithinPeakHeadroom() {
        assertEquals(6.0, LoudnessBalance.autoGainDb(LoudnessInfo(-24.0, 0.2), emptyList()), 0.001)
        assertEquals(0.0, LoudnessBalance.autoGainDb(LoudnessInfo(-24.0, 0.99), emptyList()), 0.001)
        assertEquals(-4.0, LoudnessBalance.autoGainDb(LoudnessInfo(-10.0, 0.9), emptyList()), 0.001)
        assertEquals(-5.0, LoudnessBalance.autoGainDb(null, emptyList()), 0.001)
    }

    @Test
    fun lateReadingsOnlyMoveWhenClearlyQuieter() {
        assertEquals(LoudnessBalance.Move.Set, LoudnessBalance.planMove(0.0, false, 0.0, -3.0))
        assertEquals(LoudnessBalance.Move.Ramp(2f), LoudnessBalance.planMove(5.0, false, 0.0, -3.0))
        assertNull(LoudnessBalance.planMove(20.0, false, 0.0, -1.0))
        assertEquals(LoudnessBalance.Move.Ramp(5f), LoudnessBalance.planMove(20.0, false, 0.0, -4.0))
        assertNull(LoudnessBalance.planMove(5.0, true, 0.0, -3.0))
    }
}
