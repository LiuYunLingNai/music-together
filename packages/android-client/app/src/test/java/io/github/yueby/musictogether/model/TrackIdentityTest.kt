package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TrackIdentityTest {
    @Test
    fun usesSourceAndSourceIdAcrossFreshServerResults() {
        val searchResult = track(id = "search-random-id", source = "tencent", sourceId = "0039MnYb0qxYhV")
        val playlistResult = track(id = "playlist-random-id", source = "tencent", sourceId = "0039MnYb0qxYhV")

        assertEquals(searchResult.queueIdentity(), playlistResult.queueIdentity())
    }

    @Test
    fun keepsSameProviderTracksWithDifferentSourceIdsDistinct() {
        val original = track(id = "first", source = "tencent", sourceId = "song-original")
        val liveVersion = track(id = "second", source = "tencent", sourceId = "song-live")

        assertNotEquals(original.queueIdentity(), liveVersion.queueIdentity())
    }

    @Test
    fun keepsEquivalentIdsFromDifferentProvidersDistinct() {
        val tencent = track(id = "first", source = "tencent", sourceId = "12345")
        val netease = track(id = "second", source = "netease", sourceId = "12345")

        assertNotEquals(tencent.queueIdentity(), netease.queueIdentity())
    }

    @Test
    fun fallsBackToTransientIdForLegacyTracksWithoutSourceId() {
        assertEquals("tencent:legacy-id", track(id = "legacy-id", source = "tencent", sourceId = "").queueIdentity())
    }

    @Test
    fun keepsBilibiliPartsWithDifferentCidsDistinct() {
        val firstPart = track(
            id = "first",
            source = "bilibili",
            sourceId = "BV1234567890",
            urlId = "BV1234567890?cid=100",
        )
        val secondPart = firstPart.copy(id = "second", urlId = "BV1234567890?cid=200")

        assertNotEquals(firstPart.queueIdentity(), secondPart.queueIdentity())
    }

    private fun track(id: String, source: String, sourceId: String, urlId: String = sourceId) = Track(
        id = id,
        title = "晴天",
        artist = listOf("周杰伦"),
        album = "叶惠美",
        duration = 269.0,
        cover = "",
        source = source,
        sourceId = sourceId,
        urlId = urlId,
    )
}
