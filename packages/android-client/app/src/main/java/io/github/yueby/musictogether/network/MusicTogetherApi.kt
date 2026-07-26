package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class MusicTogetherApi(private val client: OkHttpClient) {
    suspend fun bootstrapIdentity(server: ServerAddress): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(server.api("auth", "identity", "bootstrap"))
            .post(ByteArray(0).toRequestBody())
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("身份初始化失败（${response.code}）")
            response.header("X-Identity-UserId")
                ?: throw IOException("服务端未返回身份标识")
        }
    }

    suspend fun search(server: ServerAddress, keyword: String, source: String, roomId: String?): List<Track> =
        withContext(Dispatchers.IO) {
            val url = server.api("music", "search").newBuilder()
                .addQueryParameter("source", source)
                .addQueryParameter("keyword", keyword)
                .addQueryParameter("limit", "30")
                .addQueryParameter("page", "1")
                .addQueryParameter("type", "song")
                .apply { if (!roomId.isNullOrBlank()) addQueryParameter("roomId", roomId) }
                .build()
            executeJson(url).optJSONArray("tracks")?.let { array ->
                List(array.length()) { array.getJSONObject(it).toTrack() }
            }.orEmpty()
        }

    private fun executeJson(url: HttpUrl): JSONObject {
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("请求失败（${response.code}）")
            return JSONObject(response.body?.string().orEmpty())
        }
    }
}
