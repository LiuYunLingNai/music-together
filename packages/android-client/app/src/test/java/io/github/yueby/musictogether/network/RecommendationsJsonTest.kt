package io.github.yueby.musictogether.network

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
