package io.github.yueby.musictogether.network

internal fun shouldRemoveStoredPlatformCredential(
    success: Boolean,
    platform: String?,
    reason: String?,
): Boolean = !success && platform == "tencent" && reason == "reauth_required"
