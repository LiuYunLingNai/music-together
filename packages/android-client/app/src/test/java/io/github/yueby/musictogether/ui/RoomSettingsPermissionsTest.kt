package io.github.yueby.musictogether.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomSettingsPermissionsTest {
    @Test
    fun ownerCanManageAllSettings() {
        val permissions = roomSettingsPermissions(role = "owner", isServerAdmin = false)

        assertTrue(permissions.canManageAllSettings)
        assertTrue(permissions.canAdjustAudioQuality)
    }

    @Test
    fun roomAdminCanOnlyAdjustAudioQuality() {
        val permissions = roomSettingsPermissions(role = "admin", isServerAdmin = false)

        assertFalse(permissions.canManageAllSettings)
        assertTrue(permissions.canAdjustAudioQuality)
    }

    @Test
    fun serverAdminCanManageAllSettings() {
        val permissions = roomSettingsPermissions(role = "member", isServerAdmin = true)

        assertTrue(permissions.canManageAllSettings)
        assertTrue(permissions.canAdjustAudioQuality)
    }

    @Test
    fun memberCannotManageRoomSettings() {
        val permissions = roomSettingsPermissions(role = "member", isServerAdmin = false)

        assertFalse(permissions.canManageAllSettings)
        assertFalse(permissions.canAdjustAudioQuality)
    }
}
