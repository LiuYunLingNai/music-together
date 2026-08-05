package io.github.yueby.musictogether.ui

import io.github.yueby.musictogether.model.PlatformRecommendation
import org.junit.Assert.assertEquals
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
}
