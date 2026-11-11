package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.isLosslessAudioQuality
import io.github.yueby.musictogether.model.shortAudioQualityLabel
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackQualityJsonTest {
    @Test
    fun parsesServerInjectedQuality() {
        val track = JSONObject(
            """{"id": "s", "title": "t", "artist": ["a"], "source": "netease", "audioQuality": "netease_hires", "audioBitrate": 1411, "qualityDowngraded": true}""",
        ).toTrack()

        assertEquals("netease_hires", track.audioQuality)
        assertEquals(1411, track.audioBitrate)
        assertTrue(track.qualityDowngraded)
        assertEquals("Hi-Res", shortAudioQualityLabel(track.audioQuality, track.audioBitrate))
        assertTrue(isLosslessAudioQuality(track.audioQuality, track.audioBitrate))
    }

    @Test
    fun numericQualityAndMissingFieldsFallBack() {
        val numeric = JSONObject("""{"id": "s", "title": "t", "artist": [], "source": "kugou", "audioQuality": 320}""").toTrack()
        val legacy = JSONObject("""{"id": "s", "title": "t", "artist": [], "source": "kugou"}""").toTrack()

        assertEquals("320K", shortAudioQualityLabel(numeric.audioQuality, numeric.audioBitrate))
        assertFalse(isLosslessAudioQuality(numeric.audioQuality, numeric.audioBitrate))
        assertNull(legacy.audioQuality)
        assertNull(shortAudioQualityLabel(legacy.audioQuality, legacy.audioBitrate))
        assertEquals("192K", shortAudioQualityLabel(null, 192))
    }
}
