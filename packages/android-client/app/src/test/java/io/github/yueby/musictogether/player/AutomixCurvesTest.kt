package io.github.yueby.musictogether.player

import org.junit.Assert.assertEquals
import org.junit.Test

class AutomixCurvesTest {
    @Test
    fun gainsStartAndEndAtUnityAndHoldPower() {
        assertEquals(1f to 0f, AutomixCurves.gains(0.0, 0.5, 0.0))
        val (out, incoming) = AutomixCurves.gains(1.0, 0.5, 0.4)
        assertEquals(0f, out, 1e-6f)
        assertEquals(1f, incoming, 1e-6f)
        val (heldOut, heldIn) = AutomixCurves.gains(0.5, 0.5, 0.4)
        assertEquals(heldOut, heldIn, 1e-6f)
    }

    @Test
    fun lowEndChangesHandsAtTheCrossover() {
        val (startOut, startIn) = AutomixCurves.bands(0.0, 0.5, sweepOut = true, tiltMidDb = 2.0, tiltHighDb = -5.0)
        assertEquals(0f, startOut[0], 1e-6f)
        assertEquals(-24f, startIn[0], 1e-6f)
        assertEquals(2f, startIn[1], 1e-6f)
        assertEquals(-3f, startIn[2], 1e-6f)
        val (endOut, endIn) = AutomixCurves.bands(1.0, 0.5, sweepOut = true, tiltMidDb = 2.0, tiltHighDb = -5.0)
        assertEquals(-24f, endOut[0], 1e-6f)
        assertEquals(-9f, endOut[2], 1e-6f)
        assertEquals(0f, endIn[0], 1e-6f)
        assertEquals(0f, endIn[1], 1e-6f)
    }
}
