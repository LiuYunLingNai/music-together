package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.logging.AppLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SearchPage(
    val tracks: List<Track>,
    val page: Int,
    val hasMore: Boolean,
)

class MusicTogetherApi(private val client: OkHttpClient) {
    suspend fun bootstrapIdentity(server: ServerAddress): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(server.api("auth", "identity", "bootstrap"))
            .post(ByteArray(0).toRequestBody())
            .build()
        AppLogger.info("HTTP", "POST ${request.url.encodedPath}")
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("身份初始化失败（${response.code}）")
            AppLogger.info("HTTP", "identity bootstrap status=${response.code}")
            response.header("X-Identity-UserId")
                ?: throw IOException("服务端未返回身份标识")
        }
    }

    suspend fun search(server: ServerAddress, keyword: String, source: String, roomId: String?, page: Int): SearchPage =
        withContext(Dispatchers.IO) {
            val url = server.api("music", "search").newBuilder()
                .addQueryParameter("source", source)
                .addQueryParameter("keyword", keyword)
                .addQueryParameter("limit", "20")
                .addQueryParameter("page", page.toString())
                .addQueryParameter("type", "song")
                .apply { if (!roomId.isNullOrBlank()) addQueryParameter("roomId", roomId) }
                .build()
            val json = executeJson(url, "search:$source")
            val tracks = json.optJSONArray("tracks")?.let { array ->
                List(array.length()) { array.getJSONObject(it).toTrack() }
            }.orEmpty()
            SearchPage(
                tracks = tracks,
                page = json.optInt("page", page),
                hasMore = json.optBoolean("hasMore", tracks.size >= 20),
            )
        }

    suspend fun lyrics(server: ServerAddress, track: Track): JSONObject? = withContext(Dispatchers.IO) {
        val lyricId = track.lyricId?.takeIf { it.isNotBlank() } ?: return@withContext null
        val url = server.api("music", "lyric").newBuilder()
            .addQueryParameter("source", track.source)
            .addQueryParameter("lyricId", lyricId)
            .build()
        executeJson(url, "lyrics:${track.source}")
    }

    suspend fun ttml(track: Track): String? = withContext(Dispatchers.IO) {
        val folder = when (track.source) {
            "netease" -> "ncm-lyrics"
            "tencent" -> "qq-lyrics"
            else -> return@withContext null
        }
        val url = "https://amlldb.bikonoo.com/$folder/${track.sourceId}.ttml"
        val request = Request.Builder().url(url).get().build()
        val ttmlClient = client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
        AppLogger.info("HTTP", "GET TTML source=${track.source} sourceId=${track.sourceId}")
        ttmlClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                AppLogger.warn("HTTP", "TTML status=${response.code}")
                return@withContext null
            }
            response.body?.string()?.takeIf { it.contains("<tt") }
        }
    }

    private fun executeJson(url: HttpUrl, label: String): JSONObject {
        val request = Request.Builder().url(url).get().build()
        val requestClient = client.newBuilder().callTimeout(60, TimeUnit.SECONDS).build()
        AppLogger.info("HTTP", "GET ${url.encodedPath} label=$label query=${url.queryParameterNames.joinToString()}")
        requestClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                AppLogger.warn("HTTP", "$label status=${response.code} body=${body.take(300)}")
                throw IOException("请求失败（HTTP ${response.code}）：${body.take(120)}")
            }
            val json = runCatching { JSONObject(body) }.getOrElse {
                AppLogger.error("HTTP", "$label returned invalid JSON: ${body.take(300)}", it)
                throw IOException("服务端返回了无法解析的数据")
            }
            AppLogger.info("HTTP", "$label status=${response.code} items=${json.optJSONArray("tracks")?.length() ?: "n/a"}")
            return json
        }
    }
}
