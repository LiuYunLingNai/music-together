package io.github.yueby.musictogether.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDriftControllerTest {
    @Test
    fun `small positive drift slows playback without changing pitch setting`() {
        val controller = PlaybackDriftController()
        val correction = controller.update(
            currentSeconds = 10.04,
            expectedSeconds = 10.0,
            medianRttMs = 20,
            tempoSyncEnabled = true,
        )

        assertEquals(0.994f, (correction as DriftCorrection.Tempo).speed, 0.0001f)
        assertEquals(0.04, controller.currentDriftSeconds, 0.0001)
    }

    @Test
    fun `tempo correction is clamped to one percent`() {
        val correction = PlaybackDriftController().update(10.2, 10.0, 20, true)

        assertEquals(0.99f, (correction as DriftCorrection.Tempo).speed, 0.0001f)
    }

    @Test
    fun `disabled tempo sync keeps native speed`() {
        val correction = PlaybackDriftController().update(9.9, 10.0, 20, false)

        assertEquals(1f, (correction as DriftCorrection.Tempo).speed, 0f)
    }

    @Test
    fun `disabled tempo sync still hard seeks sustained large drift`() {
        val controller = PlaybackDriftController()

        assertTrue(controller.update(11.0, 10.0, 20, false) is DriftCorrection.None)
        assertTrue(controller.update(11.0, 10.0, 20, false) is DriftCorrection.Seek)
    }

    @Test
    fun `large drift requires two consecutive samples before seeking`() {
        val controller = PlaybackDriftController()

        assertTrue(controller.update(11.0, 10.0, 20, true) is DriftCorrection.None)
        val correction = controller.update(11.0, 10.0, 20, true)

        assertEquals(10.0, (correction as DriftCorrection.Seek).positionSeconds, 0.0)
    }

    @Test
    fun `high latency raises hard seek threshold`() {
        val controller = PlaybackDriftController()

        val first = controller.update(10.8, 10.0, 700, true)
        val second = controller.update(10.8, 10.0, 700, true)

        assertTrue(first is DriftCorrection.Tempo)
        assertTrue(second is DriftCorrection.Tempo)
    }
}
