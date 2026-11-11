package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import org.junit.Assert.*
import org.junit.Test

class StreamRequestTest {
    @Test
    fun `room context is optional and preserves server base path`() {
        val server = requireNotNull(ServerAddress.parse("https://example.test/base"))
        val track = Track("q", "Song", emptyList(), "", 100.0, "", "tencent", "id", "url-id")
        val url = streamRequestUrl(server, track, "tencent_flac", "room1")
        assertEquals("/base/api/music/url", url.encodedPath)
        assertEquals("room1", url.queryParameter("roomId"))
        assertEquals("tencent_flac", url.queryParameter("bitrate"))
        assertNull(streamRequestUrl(server, track, "320", null).queryParameter("roomId"))
    }
}
