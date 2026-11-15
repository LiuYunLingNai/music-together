package io.github.yueby.musictogether.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

class TrackProfileTest {
    /** A 440 Hz tone gated into short clicks at the given tempo, at the given input rate. */
    private fun profileOfClicks(bpm: Double, inRate: Int, seconds: Int): org.json.JSONObject? {
        val sink = ProfileSink(seconds.toDouble())
        sink.format(inRate, 2)
        val period = 60.0 / bpm
        val frame = DoubleArray(2)
        for (index in 0 until inRate * seconds) {
            val time = index.toDouble() / inRate
            val sinceBeat = time % period
            val value = 0.6 * exp(-sinceBeat * 40) * sin(2 * PI * 440 * time)
            frame[0] = value
            frame[1] = value
            sink.frame(frame)
        }
        return sink.result()
    }

    @Test
    fun findsTheTempoOfAClickTrackThroughTheResampler() {
        val profile = profileOfClicks(bpm = 128.0, inRate = 48_000, seconds = 60)
        assertNotNull(profile)
        assertEquals(60.0, profile!!.getDouble("duration"), 0.1)
        assertEquals(128.0, profile.getDouble("bpm"), 1.0)
        assertEquals(10, profile.getInt("version"))
        assertEquals(9, profile.getInt("key"))
    }

    @Test
    fun resamplerKeepsLevelAndLength() {
        var count = 0
        var peak = 0f
        val resampler = MidSideResampler(44_100, 22_050) { mid, _ ->
            count += 1
            if (count > 2000 && kotlin.math.abs(mid) > peak) peak = kotlin.math.abs(mid)
        }
        for (index in 0 until 44_100) resampler.add(sin(2 * PI * 1000 * index / 44_100).toFloat(), 0f)
        resampler.flush()
        assertEquals(22_050.0, count.toDouble(), 2.0)
        assertEquals(1f, peak, 0.02f)
    }
}
