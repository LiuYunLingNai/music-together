package io.github.yueby.musictogether.offline

import android.content.Context
import io.github.yueby.musictogether.model.DownloadedTrack
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.offlineDownloadKey
import io.github.yueby.musictogether.network.toJson
import io.github.yueby.musictogether.network.toTrack
import io.github.yueby.musictogether.player.PlaybackRequestHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal class OfflineLibrary(
    context: Context,
    private val client: OkHttpClient,
) {
    private companion object {
        const val DIRECTORY_NAME = "offline-audio"
        const val INDEX_FILE_NAME = "library.json"
        const val TEMPORARY_SUFFIX = ".part"
        const val MAX_AUDIO_BYTES = 500L * 1024 * 1024
    }

    private val directory = File(context.filesDir, DIRECTORY_NAME)
    private val indexFile = File(directory, INDEX_FILE_NAME)

    fun tracks(): List<DownloadedTrack> = synchronized(this) {
        val entries = readIndex().filter { entry -> audioFile(entry.key).isFile && audioFile(entry.key).length() > 0L }
        writeIndex(entries)
        entries.sortedByDescending { it.downloadedAt }
    }

    fun fileFor(track: Track): File? = synchronized(this) {
        val key = track.offlineDownloadKey()
        readIndex().firstOrNull { it.key == key }
            ?.takeIf { audioFile(it.key).isFile && audioFile(it.key).length() > 0L }
            ?.let { audioFile(it.key) }
    }

    suspend fun download(
        track: Track,
        url: String,
        onProgress: (Int?) -> Unit,
    ): DownloadedTrack = withContext(Dispatchers.IO) {
        val key = track.offlineDownloadKey()
        synchronized(this@OfflineLibrary) {
            readIndex().firstOrNull { it.key == key }
                ?.takeIf { audioFile(it.key).isFile && audioFile(it.key).length() > 0L }
                ?.let { return@withContext it }
        }
        directory.mkdirs()
        val temporary = File(directory, "${fileNameFor(key)}$TEMPORARY_SUFFIX")
        val target = audioFile(key)
        temporary.delete()
        try {
            val downloadClient = client.newBuilder()
                .readTimeout(90, TimeUnit.SECONDS)
                .callTimeout(10, TimeUnit.MINUTES)
                .addNetworkInterceptor { chain ->
                    val request = chain.request()
                    val withHeaders = request.newBuilder().apply {
                        PlaybackRequestHeaders.forHost(request.url.host).forEach { (name, value) ->
                            header(name, value)
                        }
                    }.build()
                    chain.proceed(withHeaders)
                }
                .build()
            val request = Request.Builder().url(url).get().build()
            downloadClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("歌曲下载失败（HTTP ${response.code}）")
                val body = response.body ?: throw IOException("歌曲下载响应为空")
                val total = body.contentLength()
                if (total > MAX_AUDIO_BYTES) throw IOException("歌曲文件超过允许大小")
                body.byteStream().use { input ->
                    temporary.outputStream().buffered().use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var downloaded = 0L
                        var previousProgress: Int? = null
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            downloaded += count
                            if (downloaded > MAX_AUDIO_BYTES) throw IOException("歌曲文件超过允许大小")
                            val progress = if (total > 0L) ((downloaded * 100) / total).toInt() else null
                            if (progress != previousProgress) {
                                previousProgress = progress
                                onProgress(progress)
                            }
                        }
                    }
                }
            }
            if (!temporary.renameTo(target)) {
                temporary.copyTo(target, overwrite = true)
                temporary.delete()
            }
            val entry = DownloadedTrack(
                key = key,
                track = track,
                sizeBytes = target.length(),
                downloadedAt = System.currentTimeMillis(),
            )
            synchronized(this@OfflineLibrary) {
                val entries = readIndex().filterNot { it.key == key } + entry
                writeIndex(entries)
            }
            entry
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }
    }

    fun remove(track: Track): Boolean = synchronized(this) {
        val key = track.offlineDownloadKey()
        val entries = readIndex()
        val removed = entries.any { it.key == key }
        if (!removed) return false
        audioFile(key).delete()
        writeIndex(entries.filterNot { it.key == key })
        true
    }

    private fun readIndex(): List<DownloadedTrack> {
        val array = runCatching { JSONArray(indexFile.readText()) }.getOrElse { return emptyList() }
        return List(array.length()) { index ->
            val item = array.optJSONObject(index) ?: return@List null
            val key = item.optString("key")
            val track = item.optJSONObject("track")?.toTrack()
            if (key.isBlank() || track == null || key != track.offlineDownloadKey()) {
                null
            } else {
                DownloadedTrack(
                    key = key,
                    track = track,
                    sizeBytes = item.optLong("sizeBytes").coerceAtLeast(0L),
                    downloadedAt = item.optLong("downloadedAt").coerceAtLeast(0L),
                )
            }
        }.filterNotNull()
    }

    private fun writeIndex(entries: List<DownloadedTrack>) {
        directory.mkdirs()
        val content = JSONArray().apply {
            entries.forEach { entry ->
                put(
                    JSONObject()
                        .put("key", entry.key)
                        .put("track", entry.track.toJson())
                        .put("sizeBytes", entry.sizeBytes)
                        .put("downloadedAt", entry.downloadedAt),
                )
            }
        }.toString()
        val temporary = File(directory, "$INDEX_FILE_NAME$TEMPORARY_SUFFIX")
        temporary.writeText(content)
        if (!temporary.renameTo(indexFile)) {
            temporary.copyTo(indexFile, overwrite = true)
            temporary.delete()
        }
    }

    private fun audioFile(key: String): File = File(directory, "${fileNameFor(key)}.audio")

    private fun fileNameFor(key: String): String = MessageDigest.getInstance("SHA-256")
        .digest(key.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
