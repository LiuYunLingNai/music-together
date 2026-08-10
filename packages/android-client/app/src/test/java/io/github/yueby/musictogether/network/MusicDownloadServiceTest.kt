package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class MusicDownloadServiceTest {
    @Test
    fun `parses quality format bitrate and file size with safe defaults`() {
        val response = parseDownloadOptions(
            JSONObject(
                """{
                  "trackId":"track-1",
                  "options":[
                    {"quality":320,"actualBitrate":317,"format":"MP3","fileSize":1234567},
                    {"quality":"tencent_flac","actualBitrate":null,"format":"FLAC"}
                  ]
                }""".trimIndent(),
            ),
        )

        assertEquals("track-1", response.trackId)
        assertEquals(listOf("320", "tencent_flac"), response.options.map { it.quality })
        assertEquals(317, response.options.first().actualBitrate)
        assertEquals(1_234_567L, response.options.first().fileSize)
        assertNull(response.options.last().actualBitrate)
        assertNull(response.options.last().fileSize)
    }

    @Test
    fun `prefers encoded content disposition filename and strips paths`() {
        assertEquals(
            "歌曲 + Singer.flac",
            parseDownloadFileName(
                "attachment; filename=\"fallback.flac\"; filename*=UTF-8''%E6%AD%8C%E6%9B%B2%20%2B%20Singer.flac",
                "music.flac",
            ),
        )
        assertEquals("unsafe.mp3", parseDownloadFileName("attachment; filename=\"../unsafe.mp3\"", "music.mp3"))
    }

    @Test
    fun `reports byte progress while copying response body`() {
        val input = ByteArray(150_000) { (it % 251).toByte() }
        val output = ByteArrayOutputStream()
        val progress = mutableListOf<Pair<Long, Long?>>()

        val copiedBytes = copyDownloadBody(ByteArrayInputStream(input), output, input.size.toLong()) { downloaded, total ->
            progress += downloaded to total
        }

        assertEquals(input.size.toLong(), copiedBytes)
        assertEquals(input.toList(), output.toByteArray().toList())
        assertEquals(0L to input.size.toLong(), progress.first())
        assertEquals(input.size.toLong() to input.size.toLong(), progress.last())
    }

    @Test
    fun `tracks current and average download speed with a monotonic clock`() {
        var now = 0L
        val tracker = DownloadSpeedTracker { now }

        assertNull(tracker.record(0L))
        now = 100_000_000L
        assertNull(tracker.record(100_000L))
        now = 500_000_000L
        assertEquals(400_000L, tracker.record(200_000L))
        now = 1_000_000_000L

        assertEquals(600_000L, tracker.record(500_000L))
        assertEquals(500_000L, tracker.average(500_000L))
    }

    @Test
    fun `maps download formats to media types`() {
        assertEquals("audio/flac", musicMimeType("FLAC"))
        assertEquals("audio/mp4", musicMimeType("m4a"))
        assertEquals("application/octet-stream", musicMimeType(null))
    }
}
