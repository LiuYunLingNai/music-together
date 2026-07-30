package io.github.yueby.musictogether.network

import org.junit.Assert.assertEquals
import org.junit.Test

class SearchQueryTest {
    @Test
    fun usesSourceSpecificInputLimits() {
        assertEquals(2000, searchInputMaxLength("bilibili"))
        assertEquals(100, searchInputMaxLength("netease"))
    }

    @Test
    fun preservesBilibiliLinksAndCaseSensitiveBvIds() {
        val input = "分享视频：https://www.bilibili.com/video/BV1373n6rEcP?p=1"

        assertEquals(input, normalizeSearchKeyword("  $input  ", "bilibili"))
    }

    @Test
    fun truncatesInputAtTheMatchingProtocolLimit() {
        assertEquals("x".repeat(2000), normalizeSearchKeyword("x".repeat(2100), "bilibili"))
        assertEquals("x".repeat(100), normalizeSearchKeyword("x".repeat(2100), "tencent"))
    }
}
