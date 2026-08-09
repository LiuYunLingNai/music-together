package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.RecommendationPagination
import io.github.yueby.musictogether.model.RecommendationTrackPagination
import io.github.yueby.musictogether.model.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecommendationPagingTest {
    @Test
    fun `appends tencent pages and deduplicates tracks and playlists`() {
        val current = listOf(
            PlatformRecommendation("netease", emptyList()),
            PlatformRecommendation(
                platform = "tencent",
                tracks = listOf(track("old-id", "mid-1")),
                playlists = listOf(playlist("playlist-1")),
                unavailableReason = "upstream_unavailable",
            ),
        )
        val incoming = listOf(
            PlatformRecommendation(
                platform = "tencent",
                tracks = listOf(track("new-id", "mid-1"), track("track-2", "mid-2")),
                playlists = listOf(playlist("playlist-1"), playlist("playlist-2")),
                pagination = RecommendationPagination(tracks = RecommendationTrackPagination(false, 3)),
            ),
        )

        val merged = mergeTencentRecommendationPages(current, incoming)
        val tencent = merged.single { it.platform == "tencent" }

        assertEquals(listOf("mid-1", "mid-2"), tencent.tracks.map { it.sourceId })
        assertEquals(listOf("playlist-1", "playlist-2"), tencent.playlists.map { it.id })
        assertEquals(3, tencent.pagination?.tracks?.nextPage)
        assertNull(tencent.unavailableReason)
        assertEquals("netease", merged.first().platform)
    }

    private fun track(id: String, sourceId: String) = Track(
        id = id,
        title = id,
        artist = emptyList(),
        album = "",
        duration = 0.0,
        cover = "",
        source = "tencent",
        sourceId = sourceId,
        urlId = sourceId,
    )

    private fun playlist(id: String) = Playlist(id, id, "", 10, "tencent")
}
