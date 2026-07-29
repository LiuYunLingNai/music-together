package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
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

    private fun track(source: String, urlId: String = "song-id", streamUrl: String): Track = Track(
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
    )
}
