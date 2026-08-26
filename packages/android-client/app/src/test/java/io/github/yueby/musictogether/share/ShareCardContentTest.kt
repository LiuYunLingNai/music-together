package io.github.yueby.musictogether.share

import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.ShareCardBackgroundSource
import io.github.yueby.musictogether.model.ShareCardSettings
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCardContentTest {
    @Test
    fun normalizesShareCardSettings() {
        val settings = ShareCardSettings(
            backgroundSource = ShareCardBackgroundSource.Url,
            backgroundUrl = "  https://example.com/background.jpg  ",
            backgroundBlur = 99,
            backgroundDim = -1f,
        ).normalized()

        assertEquals(ShareCardBackgroundSource.Url, settings.backgroundSource)
        assertEquals("https://example.com/background.jpg", settings.backgroundUrl)
        assertEquals(8, settings.backgroundBlur)
        assertEquals(0f, settings.backgroundDim)
    }

    @Test
    fun buildsContentFromCurrentTrack() {
        val content = ShareCardContent.from(room(track = track()), LINK)

        assertEquals("测试房间", content.roomName)
        assertEquals("夜曲", content.trackTitle)
        assertEquals("周杰伦 / 方文山", content.trackArtist)
        assertEquals("十一月的萧邦", content.trackAlbum)
        assertEquals("3:45", content.durationText)
        assertEquals("2 人正在一起听", content.listenerText)
        assertEquals(LINK, content.link)
        assertEquals("https://example.com/cover.jpg", content.coverUrl)
    }

    @Test
    fun fallsBackWhenRoomHasNoTrack() {
        val content = ShareCardContent.from(room(track = null, name = "  "), LINK)

        assertEquals("Music Together 房间", content.roomName)
        assertEquals("还没有正在播放的歌曲", content.trackTitle)
        assertEquals("", content.trackArtist)
        assertEquals("", content.durationText)
        assertNull(content.coverUrl)
    }

    @Test
    fun skipsBlankCoverUrl() {
        assertNull(ShareCardContent.from(room(track = track(cover = "  ")), LINK).coverUrl)
    }

    @Test
    fun formatsDurationText() {
        assertEquals("0:05", shareDurationText(5.0))
        assertEquals("3:45", shareDurationText(225.4))
        assertEquals("10:00", shareDurationText(600.0))
        assertEquals("", shareDurationText(0.0))
        assertEquals("", shareDurationText(-1.0))
        assertEquals("", shareDurationText(Double.NaN))
    }

    @Test
    fun describesListeners() {
        assertEquals("等你一起听", shareListenerText(0))
        assertEquals("等你一起听", shareListenerText(-3))
        assertEquals("1 人正在一起听", shareListenerText(1))
    }

    @Test
    fun joinsArtistNamesAndSkipsBlanks() {
        assertEquals("周杰伦 / 方文山", shareArtistText(track()))
        assertEquals("周杰伦", shareArtistText(track(artist = listOf("周杰伦", " "))))
        assertEquals("", shareArtistText(track(artist = emptyList())))
    }

    @Test
    fun buildsSubtitleFromAvailableFields() {
        val full = ShareCardContent.from(room(track = track()), LINK)
        assertEquals("周杰伦 / 方文山 · 十一月的萧邦", shareSubtitleText(full))

        val withoutAlbum = full.copy(trackAlbum = "")
        assertEquals("周杰伦 / 方文山", shareSubtitleText(withoutAlbum))

        assertEquals("", shareSubtitleText(full.copy(trackArtist = "", trackAlbum = "")))
    }

    @Test
    fun sanitizesFileName() {
        assertEquals("room_abc123_1700000000000.png", shareFileName("abc123", 1_700_000_000_000L))
        assertEquals("room_a_b_c_20.png", shareFileName("a/b:c", 20L))
        assertEquals("room_share_20.png", shareFileName("", 20L))
    }

    @Test
    fun encodesLinkIntoQrMatrix() {
        val matrix = QrCodeEncoder.encode(LINK)

        assertNotNull(matrix)
        requireNotNull(matrix)
        assertTrue(matrix.size >= 23)
        assertEquals(false, matrix.isDark(0, 0))
        assertTrue(matrix.isDark(1, 1))
        assertTrue(matrix.isDark(matrix.size - 2, 1))
        assertTrue(matrix.isDark(1, matrix.size - 2))
    }

    @Test
    fun rejectsBlankQrContentAndOutOfBoundsLookups() {
        assertNull(QrCodeEncoder.encode("   "))

        val matrix = requireNotNull(QrCodeEncoder.encode(LINK))
        assertEquals(false, matrix.isDark(-1, 0))
        assertEquals(false, matrix.isDark(0, matrix.size))
    }

    @Test
    fun keepsQrModulesOnWholePixels() {
        assertEquals(10f, qrModuleSize(matrixSize = 33, availablePx = 350f))
        assertEquals(0f, qrModuleSize(matrixSize = 0, availablePx = 350f))
        assertEquals(0f, qrModuleSize(matrixSize = 33, availablePx = 0f))
        assertEquals(0.5f, qrModuleSize(matrixSize = 2, availablePx = 1f))
    }

    @Test
    fun laysOutInfoColumnLeftOfQrCard() {
        val metrics = ShareCardMetrics.create()

        assertEquals(ShareCardMetrics.WIDTH, metrics.width)
        assertEquals(ShareCardMetrics.HEIGHT, metrics.height)
        assertEquals(metrics.padding, metrics.infoLeft)
        assertTrue(metrics.infoRight < metrics.qrCardRect.left)
        assertTrue(metrics.coverRect.right <= metrics.infoRight)
        assertEquals(metrics.qrCardRect.width, metrics.qrCardRect.height)
        assertEquals(metrics.width - metrics.padding, metrics.qrCardRect.right)
        assertEquals(metrics.height / 2f, metrics.qrCardRect.centerY)
        assertTrue(metrics.qrCodeRect.left > metrics.qrCardRect.left)
        assertTrue(metrics.qrCodeRect.bottom < metrics.qrCardRect.bottom)
    }

    private fun track(
        artist: List<String> = listOf("周杰伦", "方文山"),
        cover: String = "https://example.com/cover.jpg",
    ): Track = Track(
        id = "track-1",
        title = "夜曲",
        artist = artist,
        album = "十一月的萧邦",
        duration = 225.0,
        cover = cover,
        source = "tencent",
        sourceId = "source-1",
        urlId = "url-1",
    )

    private fun room(track: Track?, name: String = "测试房间"): RoomState = RoomState(
        id = "room-1",
        name = name,
        creatorId = "user-1",
        hostId = "user-1",
        hasPassword = false,
        permanent = false,
        audioQuality = "standard",
        users = listOf(user("user-1"), user("user-2")),
        queue = emptyList(),
        currentTrack = track,
        playState = PlayState(),
        playMode = "order",
    )

    private fun user(id: String): User = User(id = id, nickname = id, role = "member")

    private companion object {
        const val LINK = "https://music.example.com/room/room-1"
    }
}
