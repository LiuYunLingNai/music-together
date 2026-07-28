package io.github.yueby.musictogether.network

import android.content.Context
import io.github.yueby.musictogether.model.AppUpdateInfo
import io.github.yueby.musictogether.model.UpdateDownloadSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class AppUpdateService(private val client: OkHttpClient) {
    suspend fun latestRelease(
        apiUrl: String,
        installedVersion: String,
        flavor: String,
    ): AppUpdateInfo? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(apiUrl)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Music-Together-Android")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("更新检查失败（${response.code}）")
            val releases = JSONArray(
                (response.body ?: throw IOException("更新检查响应为空")).string(),
            )
            (0 until releases.length())
                .mapNotNull(releases::optJSONObject)
                .firstNotNullOfOrNull { release ->
                    release.toUpdateInfoOrNull(installedVersion, flavor)
                }
        }
    }

    suspend fun downloadAndVerify(
        context: Context,
        update: AppUpdateInfo,
        source: UpdateDownloadSource,
        onProgress: (Int?) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        if (!directory.isDirectory) throw IOException("无法创建更新缓存目录")
        val target = File(directory, "music-together-${update.versionName}.apk")
        val temporary = File(directory, "${target.name}.download")
        temporary.delete()

        try {
            executeAssetRequest(update.apkUrl, source).use { response ->
                if (!response.isSuccessful) throw IOException("APK 下载失败（${response.code}）")
                val body = response.body ?: throw IOException("APK 下载响应为空")
                val total = body.contentLength()
                if (total > MAX_APK_BYTES) throw IOException("更新包超过允许大小")
                val digest = MessageDigest.getInstance("SHA-256")
                body.byteStream().use { input ->
                    temporary.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        var downloaded = 0L
                        var lastProgress = -1
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            downloaded += count
                            if (downloaded > MAX_APK_BYTES) throw IOException("更新包超过允许大小")
                            val progress = if (total > 0) ((downloaded * 100) / total).toInt() else null
                            if (progress != lastProgress) {
                                lastProgress = progress ?: -1
                                onProgress(progress)
                            }
                        }
                    }
                }
                val expected = fetchChecksum(update.checksumUrl, source)
                val actual = digest.digest().joinToString("") { byte ->
                    "%02x".format(byte.toInt() and 0xff)
                }
                if (!actual.equals(expected, ignoreCase = true)) throw IOException("更新包校验失败")
            }
            if (target.exists()) target.delete()
            if (!temporary.renameTo(target)) {
                temporary.copyTo(target, overwrite = true)
                temporary.delete()
            }
            target
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }
    }

    private fun fetchChecksum(url: String, source: UpdateDownloadSource): String {
        executeAssetRequest(url, source).use { response ->
            if (!response.isSuccessful) throw IOException("更新包校验文件下载失败（${response.code}）")
            return (response.body ?: throw IOException("更新包校验文件响应为空"))
                .string().trim().substringBefore(' ').lowercase()
                .takeIf { it.matches(Regex("[0-9a-f]{64}")) }
                ?: throw IOException("更新包校验文件格式错误")
        }
    }

    private fun String.requireHttpsUrl(): String {
        if (!startsWith("https://")) throw IOException("更新地址必须使用 HTTPS")
        return this
    }

    private fun executeAssetRequest(url: String, source: UpdateDownloadSource) =
        client.newCall(Request.Builder().url(source.resolveAssetUrl(url)).build()).execute()

    internal fun UpdateDownloadSource.resolveAssetUrl(url: String): String = when (this) {
        UpdateDownloadSource.GitHub -> url
        UpdateDownloadSource.Ghfast -> "https://ghfast.top/${url.removePrefix("https://")}".requireHttpsUrl()
    }

    private fun JSONObject.toUpdateInfoOrNull(
        installedVersion: String,
        flavor: String,
    ): AppUpdateInfo? {
        if (optBoolean("draft") || optBoolean("prerelease")) return null
        val tagName = optString("tag_name")
        val versionName = tagName.removePrefix("v")
        if (versionName.isBlank() || !isNewerVersion(versionName, installedVersion)) return null

        val apkName = apkAssetName(versionName, flavor)
        val assets = optJSONArray("assets") ?: JSONArray()
        val apk = (0 until assets.length())
            .mapNotNull { assets.optJSONObject(it) }
            .firstOrNull { it.optString("name") == apkName }
            ?: return null
        val checksum = (0 until assets.length())
            .mapNotNull { assets.optJSONObject(it) }
            .firstOrNull { it.optString("name") == "${apk.optString("name")}.sha256" }
            ?: return null
        return AppUpdateInfo(
            versionName = versionName,
            releaseNotes = optString("body").trim(),
            apkUrl = apk.getString("browser_download_url").requireHttpsUrl(),
            checksumUrl = checksum.getString("browser_download_url").requireHttpsUrl(),
        )
    }

    private fun isNewerVersion(candidate: String, installed: String): Boolean {
        val candidateParts = candidate.versionParts()
        val installedParts = installed.versionParts()
        val length = maxOf(candidateParts.size, installedParts.size)
        for (index in 0 until length) {
            val comparison = candidateParts.getOrElse(index) { 0 }.compareTo(installedParts.getOrElse(index) { 0 })
            if (comparison != 0) return comparison > 0
        }
        return false
    }

    private fun String.versionParts(): List<Int> =
        removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }

    internal fun apkAssetName(versionName: String, flavor: String): String = when (flavor) {
        "vivo" -> "music-together-vivo-$versionName.apk"
        else -> "music-together-v$versionName.apk"
    }

    private companion object {
        const val MAX_APK_BYTES = 200L * 1024L * 1024L
    }
}
