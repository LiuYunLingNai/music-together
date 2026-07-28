package io.github.yueby.musictogether.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackRequestHeadersTest {
    @Test
    fun `adds bilibili headers for a bilivideo cdn`() {
        val headers = PlaybackRequestHeaders.forHost("upos-sz-mirrorcosov.bilivideo.com")

        assertEquals("https://www.bilibili.com/", headers["Referer"])
        assertEquals("https://www.bilibili.com", headers["Origin"])
        assertTrue(headers.containsKey("User-Agent"))
    }

    @Test
    fun `adds qq music headers for a stream cdn`() {
        val headers = PlaybackRequestHeaders.forHost("dl.stream.qqmusic.qq.com")

        assertEquals("https://y.qq.com/", headers["Referer"])
        assertEquals("https://y.qq.com", headers["Origin"])
    }

    @Test
    fun `adds platform headers for netease and kugou cdns`() {
        assertEquals(
            "https://music.163.com/",
            PlaybackRequestHeaders.forHost("m701.music.126.net")["Referer"],
        )
        assertEquals(
            "https://www.kugou.com/",
            PlaybackRequestHeaders.forHost("webfs.kugou.com")["Referer"],
        )
    }

    @Test
    fun `does not send platform headers to unknown hosts`() {
        assertTrue(PlaybackRequestHeaders.forHost("cdn.example.com").isEmpty())
    }
}
