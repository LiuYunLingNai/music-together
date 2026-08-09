package io.github.yueby.musictogether.network

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecommendationsJsonTest {
    @Test
    fun `parses platform tracks and unavailable reason`() {
        val json = JSONObject().put(
            "recommendations",
            JSONArray()
                .put(
                    JSONObject()
                        .put("platform", "netease")
                        .put(
                            "tracks",
                            JSONArray().put(
                                JSONObject()
                                    .put("id", "song-1")
                                    .put("title", "Recommended song")
                                    .put("artist", JSONArray().put("Artist"))
                                    .put("source", "netease"),
                            ),
                        ),
                )
                .put(
                    JSONObject()
                        .put("platform", "kugou")
                        .put("tracks", JSONArray())
                        .put("unavailableReason", "upstream_unavailable"),
                ),
        )

        val recommendations = parsePlatformRecommendations(json)

        assertEquals(listOf("netease", "kugou"), recommendations.map { it.platform })
        assertEquals("Recommended song", recommendations.first().tracks.single().title)
        assertNull(recommendations.first().unavailableReason)
        assertEquals("upstream_unavailable", recommendations.last().unavailableReason)
    }

    @Test
    fun `ignores blank platforms and accepts missing recommendations`() {
        val blankPlatform = JSONObject().put(
            "recommendations",
            JSONArray().put(JSONObject().put("platform", "").put("tracks", JSONArray())),
        )

        assertEquals(emptyList<Any>(), parsePlatformRecommendations(blankPlatform))
        assertEquals(emptyList<Any>(), parsePlatformRecommendations(JSONObject()))
    }

    @Test
    fun `round trips playlists and pagination`() {
        val source = JSONObject(
            """{
              "recommendations": [{
                "platform": "tencent",
                "tracks": [{"id":"track-1","source":"tencent","sourceId":"mid-1","title":"Radar"}],
                "playlists": [{"id":"playlist-1","name":"Daily","cover":"cover","trackCount":30,"source":"tencent"}],
                "pagination": {
                  "tracks": {"hasMore":true,"nextPage":2},
                  "playlists": {"hasMore":true,"nextOffset":12}
                }
              }]
            }""".trimIndent(),
        )

        val parsed = parsePlatformRecommendations(source).single()
        val roundTrip = parsePlatformRecommendations(
            JSONObject().put("recommendations", JSONArray().put(parsed.toJson())),
        ).single()

        assertEquals(parsed, roundTrip)
        assertEquals("Daily", parsed.playlists.single().name)
        assertTrue(parsed.pagination?.tracks?.hasMore == true)
        assertEquals(12, parsed.pagination?.playlists?.nextOffset)
    }

    @Test
    fun `missing new fields keep legacy recommendation defaults`() {
        val recommendation = parsePlatformRecommendations(
            JSONObject().put(
                "recommendations",
                JSONArray().put(JSONObject().put("platform", "bilibili").put("tracks", JSONArray())),
            ),
        ).single()

        assertEquals(emptyList<Any>(), recommendation.playlists)
        assertNull(recommendation.pagination)
    }
}
