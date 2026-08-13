package io.github.yueby.musictogether.settings

import android.content.Context
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.DEFAULT_MUSIC_DOWNLOAD_DIRECTORY
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.ThemeMode
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.model.UpdateDownloadSource
import io.github.yueby.musictogether.network.ServerCatalog
import io.github.yueby.musictogether.network.normalizeMusicDownloadDirectory
import org.json.JSONObject

internal data class PlaybackSyncSettings(
    val tempoEnabled: Boolean,
    val hardSeekEnabled: Boolean,
)

internal data class RoomRejoinCredential(
    val token: String?,
    val expiresAt: Long,
)

/**
 * Typed boundary for app-owned preferences. Network cookies remain managed by
 * PersistentCookieJar because their storage and isolation rules are separate.
 */
internal class AppPreferences(context: Context) {
    private val preferences = context.getSharedPreferences("music_together", Context.MODE_PRIVATE)

    fun initialServerUrls(defaultServerUrl: String): List<String> =
        ServerCatalog.decode(
            preferences.getString(SERVERS_KEY, null),
            preferences.getString(SERVER_URL_KEY, defaultServerUrl).orEmpty().ifBlank { defaultServerUrl },
        ).ifEmpty { listOf(defaultServerUrl) }

    fun persistServers(urls: List<String>) {
        preferences.edit().putString(SERVERS_KEY, ServerCatalog.encode(urls)).apply()
    }

    fun selectedServerUrl(defaultServerUrl: String): String =
        preferences.getString(SERVER_URL_KEY, defaultServerUrl).orEmpty().ifBlank { defaultServerUrl }

    fun selectServer(url: String) {
        preferences.edit().putString(SERVER_URL_KEY, url).apply()
    }

    fun nickname(): String = preferences.getString(NICKNAME_KEY, "").orEmpty()

    fun setNickname(value: String) {
        preferences.edit().putString(NICKNAME_KEY, value).apply()
    }

    fun clearNickname() {
        preferences.edit().remove(NICKNAME_KEY).apply()
    }

    fun updateSource(): UpdateDownloadSource =
        preferences.getString(UPDATE_SOURCE_KEY, null)
            ?.let { runCatching { UpdateDownloadSource.valueOf(it) }.getOrNull() }
            ?: UpdateDownloadSource.GitHub

    fun setUpdateSource(source: UpdateDownloadSource) {
        preferences.edit().putString(UPDATE_SOURCE_KEY, source.name).apply()
    }

    fun musicDownloadDirectory(): String = normalizeMusicDownloadDirectory(
        preferences.getString(MUSIC_DOWNLOAD_DIRECTORY_KEY, DEFAULT_MUSIC_DOWNLOAD_DIRECTORY).orEmpty(),
    )

    fun setMusicDownloadDirectory(value: String) {
        preferences.edit().putString(MUSIC_DOWNLOAD_DIRECTORY_KEY, normalizeMusicDownloadDirectory(value)).apply()
    }

    fun syncPacketInterval(defaultValue: Int, range: IntRange): Int =
        preferences.getInt(SYNC_PACKET_INTERVAL_KEY, defaultValue).coerceIn(range)

    fun setSyncPacketInterval(value: Int) {
        preferences.edit().putInt(SYNC_PACKET_INTERVAL_KEY, value).apply()
    }

    fun loadPlaybackSyncSettings(): PlaybackSyncSettings {
        val schemaVersion = preferences.getInt(PLAYBACK_SETTINGS_SCHEMA_KEY, 0)
        if (schemaVersion < PLAYBACK_SETTINGS_SCHEMA_VERSION) {
            preferences.edit()
                .putBoolean(PLAYBACK_TEMPO_SYNC_KEY, false)
                .putBoolean(PLAYBACK_HARD_SEEK_SYNC_KEY, false)
                .putInt(PLAYBACK_SETTINGS_SCHEMA_KEY, PLAYBACK_SETTINGS_SCHEMA_VERSION)
                .apply()
            return PlaybackSyncSettings(tempoEnabled = false, hardSeekEnabled = false)
        }
        return PlaybackSyncSettings(
            tempoEnabled = preferences.getBoolean(PLAYBACK_TEMPO_SYNC_KEY, false),
            hardSeekEnabled = preferences.getBoolean(PLAYBACK_HARD_SEEK_SYNC_KEY, false),
        )
    }

    fun setPlaybackTempoSync(enabled: Boolean) {
        preferences.edit().putBoolean(PLAYBACK_TEMPO_SYNC_KEY, enabled).apply()
    }

    fun setPlaybackHardSeekSync(enabled: Boolean) {
        preferences.edit().putBoolean(PLAYBACK_HARD_SEEK_SYNC_KEY, enabled).apply()
    }

    fun allowAudioMixing(): Boolean = preferences.getBoolean(ALLOW_AUDIO_MIXING_KEY, false)

    fun setAllowAudioMixing(enabled: Boolean) {
        preferences.edit().putBoolean(ALLOW_AUDIO_MIXING_KEY, enabled).apply()
    }

    fun hapticFeedbackEnabled(): Boolean = preferences.getBoolean(HAPTIC_FEEDBACK_ENABLED_KEY, true)

    fun setHapticFeedbackEnabled(enabled: Boolean) {
        preferences.edit().putBoolean(HAPTIC_FEEDBACK_ENABLED_KEY, enabled).apply()
    }

    fun uiStyle(): UiStyle = UiStyle.fromPreferenceValue(
        preferences.getString(UI_STYLE_KEY, null),
    )

    fun setUiStyle(style: UiStyle) {
        preferences.edit().putString(UI_STYLE_KEY, style.preferenceValue).apply()
    }

    fun themeMode(): ThemeMode = ThemeMode.fromPreferenceValue(
        preferences.getString(THEME_MODE_KEY, null),
    )

    fun setThemeMode(mode: ThemeMode) {
        preferences.edit().putString(THEME_MODE_KEY, mode.preferenceValue).apply()
    }

    fun pureBlackBackground(): Boolean = preferences.getBoolean(PURE_BLACK_BACKGROUND_KEY, false)

    fun setPureBlackBackground(enabled: Boolean) {
        preferences.edit().putBoolean(PURE_BLACK_BACKGROUND_KEY, enabled).apply()
    }

    fun dynamicColor(): Boolean = preferences.getBoolean(DYNAMIC_COLOR_KEY, true)

    fun setDynamicColor(enabled: Boolean) {
        preferences.edit().putBoolean(DYNAMIC_COLOR_KEY, enabled).apply()
    }

    fun appBlurEnabled(): Boolean = preferences.getBoolean(APP_BLUR_KEY, true)

    fun setAppBlurEnabled(enabled: Boolean) {
        preferences.edit().putBoolean(APP_BLUR_KEY, enabled).apply()
    }

    fun bottomBarStyle(): BottomBarStyle = BottomBarStyle.fromPreferenceValue(
        preferences.getString(BOTTOM_BAR_STYLE_KEY, null),
    )

    fun setBottomBarStyle(style: BottomBarStyle) {
        preferences.edit().putString(BOTTOM_BAR_STYLE_KEY, style.preferenceValue).apply()
    }

    fun glassBottomBar(): Boolean = preferences.getBoolean(GLASS_BOTTOM_BAR_KEY, true)

    fun setGlassBottomBar(enabled: Boolean) {
        preferences.edit().putBoolean(GLASS_BOTTOM_BAR_KEY, enabled).apply()
    }

    fun playerDisplaySettings(): PlayerDisplaySettings = PlayerDisplaySettings(
        showTranslation = preferences.getBoolean(SHOW_TRANSLATION_KEY, true),
        showRomanization = preferences.getBoolean(SHOW_ROMANIZATION_KEY, true),
        lyricFontScale = preferences.getFloat(LYRIC_FONT_SCALE_KEY, 1f).coerceIn(0.8f, 1.3f),
        lyricFontWeight = preferences.getInt(LYRIC_FONT_WEIGHT_KEY, 600).coerceIn(400, 800),
        lyricAlignPosition = preferences.getFloat(LYRIC_ALIGN_POSITION_KEY, 0.10f).coerceIn(0.05f, 0.45f),
        lyricSpringAnimation = preferences.getBoolean(LYRIC_SPRING_KEY, true),
        lyricScaleEffect = preferences.getBoolean(LYRIC_SCALE_KEY, true),
        lyricBlurEffect = preferences.getBoolean(LYRIC_BLUR_KEY, false),
        backgroundMotion = preferences.getBoolean(BACKGROUND_MOTION_KEY, true),
        backgroundMotionStrength = preferences.getFloat(BACKGROUND_MOTION_STRENGTH_KEY, 1f).coerceIn(0.5f, 1.5f),
    )

    fun setPlayerDisplaySettings(settings: PlayerDisplaySettings) {
        preferences.edit()
            .putBoolean(SHOW_TRANSLATION_KEY, settings.showTranslation)
            .putBoolean(SHOW_ROMANIZATION_KEY, settings.showRomanization)
            .putFloat(LYRIC_FONT_SCALE_KEY, settings.lyricFontScale.coerceIn(0.8f, 1.3f))
            .putInt(LYRIC_FONT_WEIGHT_KEY, settings.lyricFontWeight.coerceIn(400, 800))
            .putFloat(LYRIC_ALIGN_POSITION_KEY, settings.lyricAlignPosition.coerceIn(0.05f, 0.45f))
            .putBoolean(LYRIC_SPRING_KEY, settings.lyricSpringAnimation)
            .putBoolean(LYRIC_SCALE_KEY, settings.lyricScaleEffect)
            .putBoolean(LYRIC_BLUR_KEY, settings.lyricBlurEffect)
            .putBoolean(BACKGROUND_MOTION_KEY, settings.backgroundMotion)
            .putFloat(BACKGROUND_MOTION_STRENGTH_KEY, settings.backgroundMotionStrength.coerceIn(0.5f, 1.5f))
            .apply()
    }

    fun loadLyricOffsets(): Map<String, Int> {
        val raw = preferences.getString(LYRIC_OFFSETS_KEY, null) ?: return emptyMap()
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = json.optInt(key, 0).coerceIn(-10_000, 10_000)
                if (value != 0) put(key, value)
            }
        }
    }

    fun persistLyricOffsets(offsets: Map<String, Int>) {
        val json = JSONObject()
        offsets.forEach { (key, value) -> json.put(key, value) }
        preferences.edit().putString(LYRIC_OFFSETS_KEY, json.toString()).apply()
    }

    fun saveRoomRejoin(serverUrl: String, roomId: String, token: String, expiresAt: Long) {
        val key = rejoinKey(serverUrl, roomId)
        preferences.edit()
            .putString(key, token)
            .putLong("$key:expires", expiresAt)
            .apply()
    }

    fun roomRejoin(serverUrl: String, roomId: String): RoomRejoinCredential {
        val key = rejoinKey(serverUrl, roomId)
        return RoomRejoinCredential(
            token = preferences.getString(key, null),
            expiresAt = preferences.getLong("$key:expires", 0),
        )
    }

    fun clearRoomRejoin(serverUrl: String, roomId: String) {
        val key = rejoinKey(serverUrl, roomId)
        preferences.edit().remove(key).remove("$key:expires").apply()
    }

    fun platformCookie(serverUrl: String, platform: String): String? =
        preferences.getString(platformCookieKey(serverUrl, platform), null)
            ?.takeIf { it.isNotBlank() }

    fun storePlatformCookie(serverUrl: String, platform: String, cookie: String) {
        preferences.edit().putString(platformCookieKey(serverUrl, platform), cookie).apply()
        AppLogger.info("Auth", "stored platform credential platform=$platform server=$serverUrl")
    }

    fun removePlatformCookie(serverUrl: String, platform: String) {
        preferences.edit().remove(platformCookieKey(serverUrl, platform)).apply()
    }

    fun clearIdentityBoundState(serverUrl: String) {
        val prefixes = listOf("platform_auth:$serverUrl:", "rejoin:$serverUrl:")
        val editor = preferences.edit()
        preferences.all.keys.filter { key -> prefixes.any(key::startsWith) }.forEach(editor::remove)
        editor.apply()
    }

    private fun rejoinKey(serverUrl: String, roomId: String): String =
        "rejoin:$serverUrl:$roomId"

    private fun platformCookieKey(serverUrl: String, platform: String): String =
        "platform_auth:$serverUrl:$platform"

    private companion object {
        const val SERVER_URL_KEY = "server_url"
        const val SERVERS_KEY = "server_urls"
        const val NICKNAME_KEY = "nickname"
        const val UPDATE_SOURCE_KEY = "update_download_source"
        const val MUSIC_DOWNLOAD_DIRECTORY_KEY = "music_download_directory"
        const val LYRIC_OFFSETS_KEY = "lyric_offsets"
        const val PLAYBACK_TEMPO_SYNC_KEY = "playback_tempo_sync_enabled"
        const val PLAYBACK_HARD_SEEK_SYNC_KEY = "playback_hard_seek_sync_enabled"
        const val ALLOW_AUDIO_MIXING_KEY = "allow_audio_mixing"
        const val HAPTIC_FEEDBACK_ENABLED_KEY = "haptic_feedback_enabled"
        const val UI_STYLE_KEY = "ui_style"
        const val THEME_MODE_KEY = "theme_mode"
        const val PURE_BLACK_BACKGROUND_KEY = "pure_black_background"
        const val DYNAMIC_COLOR_KEY = "dynamic_color"
        const val APP_BLUR_KEY = "app_blur_enabled"
        const val BOTTOM_BAR_STYLE_KEY = "bottom_bar_style"
        const val GLASS_BOTTOM_BAR_KEY = "glass_bottom_bar"
        const val SHOW_TRANSLATION_KEY = "player_show_translation"
        const val SHOW_ROMANIZATION_KEY = "player_show_romanization"
        const val LYRIC_FONT_SCALE_KEY = "player_lyric_font_scale"
        const val LYRIC_FONT_WEIGHT_KEY = "player_lyric_font_weight"
        const val LYRIC_ALIGN_POSITION_KEY = "player_lyric_align_position"
        const val LYRIC_SPRING_KEY = "player_lyric_spring"
        const val LYRIC_SCALE_KEY = "player_lyric_scale"
        const val LYRIC_BLUR_KEY = "player_lyric_blur"
        const val BACKGROUND_MOTION_KEY = "player_background_motion"
        const val BACKGROUND_MOTION_STRENGTH_KEY = "player_background_motion_strength"
        const val PLAYBACK_SETTINGS_SCHEMA_KEY = "playback_settings_schema_version"
        const val PLAYBACK_SETTINGS_SCHEMA_VERSION = 2
        const val SYNC_PACKET_INTERVAL_KEY = "sync_packet_interval_seconds"
    }
}
