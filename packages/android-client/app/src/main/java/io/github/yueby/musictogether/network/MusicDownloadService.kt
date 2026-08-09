package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.DownloadQualityOption
import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.net.URLDecoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class DownloadOptionsResponse(
    val trackId: String,
    val options: List<DownloadQualityOption>,
)

internal data class MusicDownloadResult(
    val fileName: String,
    val contentType: String?,
    val contentLength: Long?,
    val downloadedBytes: Long,
)

internal class MusicDownloadService(private val client: OkHttpClient) {
    suspend fun options(server: ServerAddress, roomId: String, trackId: String): DownloadOptionsResponse {
        val url = server.api("music", "download-options").newBuilder()
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("trackId", trackId)
            .build()
        val request = Request.Builder().url(url).get().build()
        AppLogger.info("Download", "load options track=$trackId")
        return client.newCall(request).awaitResponse().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw response.toApiException(body)
            parseDownloadOptions(JSONObject(body))
        }
    }

    suspend fun download(
        server: ServerAddress,
        roomId: String,
        trackId: String,
        quality: String,
        fallbackFileName: String,
        output: OutputStream,
        onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit = { _, _ -> },
    ): MusicDownloadResult = suspendCancellableCoroutine { continuation ->
        val url = server.api("music", "download").newBuilder()
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("trackId", trackId)
            .addQueryParameter("quality", quality)
            .build()
        val call = client.newCall(Request.Builder().url(url).get().build())
        continuation.invokeOnCancellation {
            call.cancel()
            runCatching { output.close() }
        }
        AppLogger.info("Download", "start track=$trackId quality=$quality")
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runCatching { output.close() }
                if (continuation.isActive) continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use { value ->
                        if (!value.isSuccessful) {
                            val body = value.body?.string().orEmpty()
                            throw value.toApiException(body)
                        }
                        val body = value.body ?: throw IOException("服务端未返回下载内容")
                        val totalBytes = value.header("Content-Length")?.toLongOrNull()
                            ?.takeIf { it > 0 }
                            ?: body.contentLength().takeIf { it > 0 }
                        val downloadedBytes = copyDownloadBody(body.byteStream(), output, totalBytes, onProgress)
                        val result = MusicDownloadResult(
                            fileName = parseDownloadFileName(
                                value.header("Content-Disposition"),
                                fallbackFileName,
                            ),
                            contentType = value.header("Content-Type"),
                            contentLength = value.header("Content-Length")?.toLongOrNull(),
                            downloadedBytes = downloadedBytes,
                        )
                        if (continuation.isActive) continuation.resume(result)
                    }
                } catch (error: Throwable) {
                    runCatching { output.close() }
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
            }
        })
    }
}

internal fun copyDownloadBody(
    source: java.io.InputStream,
    output: OutputStream,
    totalBytes: Long?,
    onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit,
): Long {
    var downloadedBytes = 0L
    var lastProgressAt = 0L
    val buffer = ByteArray(DEFAULT_DOWNLOAD_BUFFER_SIZE)
    onProgress(0, totalBytes)
    output.use { destination ->
        source.use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                destination.write(buffer, 0, count)
                downloadedBytes += count
                val now = System.currentTimeMillis()
                if (now - lastProgressAt >= PROGRESS_UPDATE_INTERVAL_MS) {
                    onProgress(downloadedBytes, totalBytes)
                    lastProgressAt = now
                }
            }
            destination.flush()
        }
    }
    onProgress(downloadedBytes, totalBytes)
    return downloadedBytes
}

internal fun parseDownloadOptions(json: JSONObject): DownloadOptionsResponse {
    val options = json.optJSONArray("options") ?: JSONArray()
    return DownloadOptionsResponse(
        trackId = json.optString("trackId"),
        options = List(options.length()) { index ->
            val value = options.getJSONObject(index)
            DownloadQualityOption(
                quality = value.audioQuality("quality", ""),
                actualBitrate = value.intOrNull("actualBitrate"),
                format = value.stringOrNull("format"),
                fileSize = value.longOrNull("fileSize"),
            )
        }.filter { it.quality.isNotBlank() },
    )
}

internal fun parseDownloadFileName(contentDisposition: String?, fallback: String): String {
    if (!contentDisposition.isNullOrBlank()) {
        val encoded = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE)
            .find(contentDisposition)
            ?.groupValues
            ?.getOrNull(1)
        if (!encoded.isNullOrBlank()) {
            runCatching { URLDecoder.decode(encoded.replace("+", "%2B"), Charsets.UTF_8.name()) }
                .getOrNull()
                ?.let(::safeDownloadFileName)
                ?.takeIf { it.isNotBlank() }
                ?.let { return it }
        }
        Regex("filename=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
            .find(contentDisposition)
            ?.groupValues
            ?.getOrNull(1)
            ?.let(::safeDownloadFileName)
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }
    }
    return safeDownloadFileName(fallback).ifBlank { "music" }
}

internal fun suggestedMusicFileName(track: Track, format: String?): String {
    val artists = track.artist.joinToString(", ").takeIf { it.isNotBlank() }
    val base = listOfNotNull(track.title.takeIf { it.isNotBlank() }, artists).joinToString(" - ")
    val extension = format?.trim()?.lowercase()?.takeIf { it.matches(Regex("[a-z0-9]{2,6}")) } ?: "mp3"
    return "${safeDownloadFileName(base).ifBlank { "music" }.take(180)}.$extension"
}

internal fun musicMimeType(format: String?): String = when (format?.trim()?.lowercase()) {
    "flac" -> "audio/flac"
    "m4a", "mp4" -> "audio/mp4"
    "aac" -> "audio/aac"
    "ogg" -> "audio/ogg"
    "wav" -> "audio/wav"
    "mp3" -> "audio/mpeg"
    else -> "application/octet-stream"
}

private fun safeDownloadFileName(value: String): String = value
    .substringAfterLast('/')
    .substringAfterLast('\\')
    .replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f\\u007f]"), "_")
    .trim()
    .trimEnd('.', ' ')

private fun JSONObject.intOrNull(name: String): Int? =
    if (has(name) && !isNull(name)) optInt(name) else null

private fun JSONObject.longOrNull(name: String): Long? =
    if (has(name) && !isNull(name)) optLong(name) else null

private fun Response.toApiException(body: String): ApiException {
    val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
        ?.takeIf { it.isNotBlank() }
        ?: "请求失败（HTTP $code）"
    return ApiException(code, message)
}

private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) continuation.resume(response) else response.close()
        }
    })
}

private const val DEFAULT_DOWNLOAD_BUFFER_SIZE = 64 * 1024
private const val PROGRESS_UPDATE_INTERVAL_MS = 250L
