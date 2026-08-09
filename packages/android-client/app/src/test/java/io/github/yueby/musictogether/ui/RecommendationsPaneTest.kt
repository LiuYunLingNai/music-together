package io.github.yueby.musictogether.ui

import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecommendationsPaneTest {
    @Test
    fun recommendationPlatformsPreserveResponseOrderAndRemoveDuplicates() {
        val recommendations = listOf(
            PlatformRecommendation(platform = "netease", tracks = emptyList()),
            PlatformRecommendation(platform = "kugou", tracks = emptyList()),
            PlatformRecommendation(platform = "netease", tracks = emptyList()),
        )

        assertEquals(listOf("netease", "kugou"), recommendationPlatforms(recommendations))
    }

    @Test
    fun legacyPlatformTracksRemainVisibleWhenPlaylistsAreMissing() {
        val legacy = PlatformRecommendation(platform = "netease", tracks = listOf(track()))
        val modern = legacy.copy(playlists = listOf(Playlist("list", "List", "", 1, "netease")))

        assertTrue(recommendationShowsTracks(legacy, "tracks"))
        assertFalse(recommendationShowsTracks(modern, "tracks"))
    }

    private fun track() = Track(
        id = "track",
        title = "Track",
        artist = emptyList(),
        album = "",
        duration = 0.0,
        cover = "",
        source = "netease",
        sourceId = "source-track",
        urlId = "source-track",
    )
}
