package io.github.yueby.musictogether.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatformAuthPolicyTest {
    @Test
    fun `only explicit tencent reauth required removes stored credential`() {
        assertTrue(shouldRemoveStoredPlatformCredential(false, "tencent", "reauth_required"))
        assertFalse(shouldRemoveStoredPlatformCredential(false, "tencent", "expired"))
        assertFalse(shouldRemoveStoredPlatformCredential(false, "tencent", "error"))
        assertFalse(shouldRemoveStoredPlatformCredential(false, "netease", "reauth_required"))
        assertFalse(shouldRemoveStoredPlatformCredential(true, "tencent", "reauth_required"))
    }
}
