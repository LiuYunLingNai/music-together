package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class TtmlFallbackTest {
    private val track = Track("q1", "Song & Name", listOf("Singer One", "歌手"), "Album", 120.0, "", "netease", "123", "123")
    private val server = requireNotNull(ServerAddress.parse("https://server.test/music"))

    @Test
    fun `server paths preserve base path and exact platform identity`() {
        val urls = ttmlFallbackUrls(server, track)
        assertEquals("/music/api/music/ttml", urls[0].encodedPath)
        assertEquals("https://amlldb.bikonoo.com/ncm-lyrics/123.ttml", urls[0].queryParameter("url"))
        assertEquals("ncm", urls[1].queryParameter("platform"))
        assertEquals("Song & Name", urls[1].queryParameter("title"))
        assertEquals(track.artist, urls[1].queryParameterValues("artists"))
    }

    @Test
    fun `bilibili metadata uses selected song rather than video id`() {
        val urls = ttmlFallbackUrls(server, track.copy(source = "bilibili", sourceId = "BV1", metadataSource = "tencent", lyricId = "qqmid"))
        assertEquals("qq", urls[1].queryParameter("platform"))
        assertEquals("qqmid", urls[1].queryParameter("id"))
        assertTrue(ttmlFallbackUrls(server, track.copy(source = "kugou")).isEmpty())
    }

    @Test
    fun `successful proxy avoids other requests`() = runBlocking {
        val calls = mutableListOf<String>()
        val result = loadTtmlWithFallback(ttmlFallbackUrls(server, track)) { calls += it.encodedPath; "<tt xmlns=\"test\"></tt>" }
        assertNotNull(result)
        assertEquals(1, calls.size)
    }

    @Test
    fun `unavailable old server falls back to legacy direct endpoint`() = runBlocking {
        val calls = mutableListOf<String>()
        val result = loadTtmlWithFallback(ttmlFallbackUrls(server, track)) {
            calls += it.host
            if (it.host == "server.test") null else "<tt></tt>"
        }
        assertEquals("<tt></tt>", result)
        assertEquals(listOf("server.test", "server.test", "amlldb.bikonoo.com"), calls)
    }

    @Test
    fun `network error or non ttml content continues to next source`() = runBlocking {
        var count = 0
        val result = loadTtmlWithFallback(ttmlFallbackUrls(server, track)) {
            when (++count) { 1 -> throw IOException("offline"); 2 -> "<html>404</html>"; else -> "<tt></tt>" }
        }
        assertEquals("<tt></tt>", result)
    }

    @Test
    fun `caller cancellation is never consumed as missing lyrics`() = runBlocking {
        var count = 0
        try {
            loadTtmlWithFallback(ttmlFallbackUrls(server, track)) { count++; throw CancellationException("song changed") }
            fail("Cancellation expected")
        } catch (_: CancellationException) {
            assertEquals(1, count)
        }
    }
}
