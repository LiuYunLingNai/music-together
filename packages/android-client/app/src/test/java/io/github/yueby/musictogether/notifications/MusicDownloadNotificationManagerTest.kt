package io.github.yueby.musictogether.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

class MusicDownloadNotificationManagerTest {
    @Test
    fun `formats download speed using an appropriate unit`() {
        assertEquals("512 B/s", formatDownloadSpeed(512L))
        assertEquals("1.5 KB/s", formatDownloadSpeed(1_536L))
        assertEquals("2.5 MB/s", formatDownloadSpeed(2_621_440L))
        assertEquals("1.5 GB/s", formatDownloadSpeed(1_610_612_736L))
    }
}
