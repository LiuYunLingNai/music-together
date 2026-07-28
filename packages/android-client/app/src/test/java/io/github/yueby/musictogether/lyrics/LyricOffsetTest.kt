package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LyricOffsetTest {
    @Test
    fun usesLyricSourceAndIdForMusicTracks() {
        val track = track(source = "netease", lyricId = "123")

        assertEquals("netease:123", lyricOffsetKey(track))
    }

    @Test
    fun scopesBilibiliOffsetsToTheVideoAndMetadataSource() {
        val track = track(
            source = "bilibili",
            urlId = "BV1xx",
            lyricId = "123",
            metadataSource = "tencent",
        )

        assertEquals("bilibili:BV1xx:tencent:123", lyricOffsetKey(track))
    }

    @Test
    fun doesNotCreateAnOffsetKeyWithoutLyrics() {
        assertNull(lyricOffsetKey(track(lyricId = null)))
    }

    private fun track(
        source: String = "netease",
        urlId: String = "123",
        lyricId: String? = "123",
        metadataSource: String? = null,
    ) = Track(
        id = "track-1",
        title = "Track",
        artist = listOf("Artist"),
        album = "Album",
        duration = 180.0,
        cover = "",
        source = source,
        sourceId = "123",
        urlId = urlId,
        lyricId = lyricId,
        metadataSource = metadataSource,
    )
}
