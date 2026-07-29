package io.github.yueby.musictogether.ui

import org.junit.Assert.assertNull
import org.junit.Test

class CoverImageRequestTest {
    @Test
    fun `cover requests do not send referrer headers`() {
        assertNull(coverNetworkHeaders["Referer"])
        assertNull(coverNetworkHeaders["Origin"])
    }
}
