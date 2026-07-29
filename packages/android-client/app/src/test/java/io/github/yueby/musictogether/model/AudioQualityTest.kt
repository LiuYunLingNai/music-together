package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioQualityTest {
    @Test
    fun exposesOnlyCrossPlatformRoomQualityChoices() {
        val options = availableAudioQualities()

        assertEquals(listOf("128", "192", "320", "999", "highest"), options.map { it.value })
        assertEquals(1, options.count { it.value == "999" })
        assertTrue(options.any { it.value == "highest" && it.label == "尽量高" })
    }

    @Test
    fun labelsLegacyAndNewServerQualityValues() {
        assertEquals("B站 Hi-Res", audioQualityLabel("bilibili_hires"))
        assertEquals("酷狗蝰蛇母带 2.0", audioQualityLabel("kugou_master"))
    }
}
