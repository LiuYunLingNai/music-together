package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.AudioProxyPolicy
import io.github.yueby.musictogether.model.Track
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackUrlTest {
    private val api = MusicTogetherApi(OkHttpClient())
    private val server = ServerAddress.parse("https://music.example.com")!!

    @Test
    fun `routes bilibili audio through the server proxy`() {
        val track = track(
            source = "bilibili",
            urlId = "BV1234567890",
            streamUrl = "https://cn-zjjh-ct-04-05.bilivideo.com/audio.m4s?expires=1&sign=a+b",
        )

        val url = api.playbackUrl(server, track, "ROOM01")!!

        assertEquals("music.example.com", url.substringAfter("https://").substringBefore('/'))
        assertTrue(url.contains("/api/music/bilibili-audio-proxy?"))
        assertTrue(url.contains("bvid=BV1234567890"))
        assertTrue(url.contains("roomId=ROOM01"))
        assertTrue(url.contains("url=https%3A%2F%2Fcn-zjjh-ct-04-05.bilivideo.com%2Faudio.m4s%3Fexpires%3D1%26sign%3Da%2Bb"))
    }

    @Test
    fun `preserves a selected bilibili part cid in the proxy request`() {
        val url = api.playbackUrl(
            server,
            track(
                source = "bilibili",
                urlId = "BV1234567890?cid=123456",
                streamUrl = "https://cdn.bilivideo.com/audio.m4s",
            ),
            "ROOM01",
        )!!

        assertTrue(url.contains("bvid=BV1234567890%3Fcid%3D123456"))
    }

    @Test
    fun `routes both kugou editions through the server proxy`() {
        val streamUrl = "http://fs.youthandroid.kugou.com/audio.flac?token=abc"

        listOf("kugou", "kugou_concept").forEach { source ->
            val url = api.playbackUrl(server, track(source = source, streamUrl = streamUrl))!!
            assertTrue(url.contains("/api/music/kugou-audio-proxy?"))
            assertTrue(url.contains("url=http%3A%2F%2Ffs.youthandroid.kugou.com%2Faudio.flac%3Ftoken%3Dabc"))
        }
    }

    @Test
    fun `keeps other platform audio direct`() {
        val streamUrl = "https://music.example.com/audio.mp3"

        assertEquals(streamUrl, api.playbackUrl(server, track(source = "tencent", streamUrl = streamUrl)))
    }

    @Test
    fun `always routes bilibili through the server proxy`() {
        val streamUrl = "https://cdn.bilivideo.com/audio.m4s"
        val target = api.playbackTarget(
            server,
            track(source = "bilibili", urlId = "BV1234567890", streamUrl = streamUrl),
            "ROOM01",
            AudioProxyPolicy(kugouForceProxy = false),
        )!!

        assertTrue(target.primaryUrl.contains("/api/music/bilibili-audio-proxy?"))
        assertNull(target.fallbackUrl)
        assertTrue(target.usesServerProxy)
    }

    @Test
    fun `allows both kugou editions direct playback with a proxy fallback`() {
        val streamUrl = "http://fs.kugou.com/audio.flac"
        listOf("kugou", "kugou_concept").forEach { source ->
            val target = api.playbackTarget(
                server,
                track(source = source, streamUrl = streamUrl),
                policy = AudioProxyPolicy(kugouForceProxy = false),
            )!!

            assertEquals(streamUrl, target.primaryUrl)
            assertTrue(target.fallbackUrl!!.contains("/api/music/kugou-audio-proxy?"))
            assertFalse(target.usesServerProxy)
        }
    }

    @Test
    fun `routes encrypted kugou audio directly through the proxy when forced proxy is disabled`() {
        val streamUrl = "http://fs.kugou.com/audio.mflac"
        val target = api.playbackTarget(
            server,
            track(source = "kugou_concept", streamUrl = streamUrl, requiresServerProxy = true),
            policy = AudioProxyPolicy(kugouForceProxy = false),
        )!!

        assertTrue(target.primaryUrl.contains("/api/music/kugou-audio-proxy?"))
        assertNull(target.fallbackUrl)
        assertTrue(target.usesServerProxy)
    }

    private fun track(
        source: String,
        urlId: String = "song-id",
        streamUrl: String,
        requiresServerProxy: Boolean = false,
    ): Track = Track(
        id = "track-id",
        title = "title",
        artist = listOf("artist"),
        album = "album",
        duration = 1.0,
        cover = "",
        source = source,
        sourceId = "source-id",
        urlId = urlId,
        streamUrl = streamUrl,
        requiresServerProxy = requiresServerProxy,
    )
}
