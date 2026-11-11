package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UserPlaylistJsonTest {
    @Test
    fun parsesPlaylistListWithNullCover() {
        val playlists = parseUserPlaylists(
            JSONObject(
                """
                {"playlists": [
                  {"id": "p1", "name": "通勤", "cover": null, "trackCount": 0, "createdAt": 1, "updatedAt": 2},
                  {"id": "p2", "name": "夜晚", "cover": "https://c", "trackCount": 12, "createdAt": 3, "updatedAt": 4}
                ]}
                """.trimIndent(),
            ),
        )

        assertEquals(listOf("p1", "p2"), playlists.map { it.id })
        assertNull(playlists[0].cover)
        assertEquals("https://c", playlists[1].cover)
        assertEquals(12, playlists[1].trackCount)
        assertEquals(4L, playlists[1].updatedAt)
    }

    @Test
    fun parsesDetailTracksAcrossSources() {
        val detail = JSONObject(
            """
            {"id": "p1", "name": "混合", "cover": null, "trackCount": 2, "createdAt": 1, "updatedAt": 1,
             "tracks": [
               {"id": "a", "title": "A", "artist": ["x"], "source": "netease"},
               {"id": "b", "title": "B", "artist": ["y"], "source": "tencent"}
             ]}
            """.trimIndent(),
        ).toUserPlaylistDetail()

        assertEquals("混合", detail.playlist.name)
        assertEquals(listOf("netease", "tencent"), detail.tracks.map { it.source })
    }

    @Test
    fun trackJsonRoundTripKeepsIdentityForPlaylistUpload() {
        val track = JSONObject("""{"id": "s1", "title": "T", "artist": ["a"], "source": "kugou", "sourceId": "k1", "urlId": "u1"}""").toTrack()
        val restored = track.toJson().toTrack()

        assertEquals(track.id, restored.id)
        assertEquals(track.source, restored.source)
        assertEquals(track.sourceId, restored.sourceId)
        assertEquals(track.urlId, restored.urlId)
    }
}
