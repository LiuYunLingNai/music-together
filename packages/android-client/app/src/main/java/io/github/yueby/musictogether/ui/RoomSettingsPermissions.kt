package io.github.yueby.musictogether.ui

internal data class RoomSettingsPermissions(
    val canManageAllSettings: Boolean,
    val canAdjustAudioQuality: Boolean,
)

internal fun roomSettingsPermissions(role: String?, isServerAdmin: Boolean): RoomSettingsPermissions {
    val canManageAllSettings = role == "owner" || isServerAdmin
    return RoomSettingsPermissions(
        canManageAllSettings = canManageAllSettings,
        canAdjustAudioQuality = canManageAllSettings || role == "admin",
    )
}
