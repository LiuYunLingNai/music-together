package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioQualityTest {
    @Test
    fun onlyAddsPlatformQualitiesForVipAccounts() {
        val options = availableAudioQualities(
            listOf(
                PlatformAuthStatus("netease", 1, true, 11),
                PlatformAuthStatus("tencent", 1, false, 0),
            ),
        )

        assertTrue(options.any { it.value == "netease_master" })
        assertFalse(options.any { it.value == "tencent_master" })
        assertEquals(1, options.count { it.value == "999" })
    }
}
