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

    @Test
    fun roomStateParsesHiddenFlagWithLegacyFallback() {
        assertTrue(roomJson().put("hidden", true).toRoomState().hidden)
        assertFalse(roomJson().toRoomState().hidden)
    }

    @Test
    fun trackPreservesBilibiliMetadataFields() {
        val track = JSONObject(
            """{
              "id": "bvid-1",
              "title": "Video",
              "artist": ["Uploader"],
              "album": "Bilibili",
              "duration": 180,
              "cover": "https://cover.example/metadata.jpg",
              "bilibiliCover": "https://cover.example/video.jpg",
              "source": "bilibili",
              "sourceId": "BV1xx",
              "urlId": "BV1xx",
              "lyricId": "123",
              "picId": "123",
              "metadataSource": "netease",
              "streamFormat": "flac"
            }""".trimIndent(),
        ).toTrack()

        assertEquals("bilibili", track.source)
        assertEquals("https://cover.example/video.jpg", track.bilibiliCover)
        assertEquals("netease", track.metadataSource)
        assertEquals("flac", track.streamFormat)
        assertEquals("netease", track.toJson().getString("metadataSource"))
        assertEquals("flac", track.toJson().getString("streamFormat"))
    }

    @Test
    fun platformAuthPreservesMembershipDetails() {
        val roomStatus = JSONObject(
            """{"platform":"kugou_concept","loggedInCount":1,"hasVip":true,"maxVipType":1,"maxVipLabel":"畅听 VIP","maxVipLevel":3}""",
        ).toPlatformAuthStatus()
        val myStatus = JSONObject(
            """{"platform":"kugou_concept","loggedIn":true,"nickname":"User","vipType":1,"vipLabel":"畅听 VIP","vipLevel":3}""",
        ).toMyPlatformAuth()

        assertEquals("畅听 VIP", roomStatus.maxVipLabel)
        assertEquals(3, roomStatus.maxVipLevel)
        assertEquals("畅听 VIP", myStatus.vipLabel)
        assertEquals(3, myStatus.vipLevel)
    }

    @Test
    fun roomStatePreservesServerAdministratorFlag() {
        val json = roomJson().put(
            "users",
            org.json.JSONArray().put(
                JSONObject()
                    .put("id", "server-admin")
                    .put("nickname", "Admin")
                    .put("role", "member")
                    .put("isServerAdmin", true),
            ),
        )

        val user = json.toRoomState().users.single()

        assertEquals("member", user.role)
        assertTrue(user.isServerAdmin)
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
