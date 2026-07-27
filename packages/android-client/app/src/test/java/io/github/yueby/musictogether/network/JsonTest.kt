package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonTest {
    @Test
    fun roomStateParsesLegacyNumericAudioQuality() {
        val room = roomJson().put("audioQuality", 999).toRoomState()

        assertEquals("999", room.audioQuality)
    }

    @Test
    fun roomStatePreservesPlatformAudioQuality() {
        val room = roomJson().put("audioQuality", "tencent_master").toRoomState()

        assertEquals("tencent_master", room.audioQuality)
    }

    @Test
    fun audioQualityFallsBackWhenUpdateOmitsValue() {
        assertEquals("netease_hires", JSONObject().audioQuality("audioQuality", "netease_hires"))
    }

    @Test
    fun roomStateParsesPermanentFlagWithLegacyFallback() {
        assertTrue(roomJson().put("permanent", true).toRoomState().permanent)
        assertFalse(roomJson().toRoomState().permanent)
    }

    private fun roomJson() = JSONObject(
        """{
          "id": "room-1",
          "name": "Test",
          "creatorId": "owner-1",
          "hostId": "owner-1",
          "users": [],
          "queue": [],
          "playState": {}
        }""".trimIndent(),
    )
}
