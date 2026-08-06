package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AccountProfile
import io.github.yueby.musictogether.model.AdminRoom
import io.github.yueby.musictogether.model.AdminUser
import io.github.yueby.musictogether.model.AudioProxyPolicy
import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SearchPage(
    val tracks: List<Track>,
    val page: Int,
    val hasMore: Boolean,
)

data class BilibiliCollectionPage(
    val title: String,
    val tracks: List<Track>,
)

data class PlaylistPage(
    val tracks: List<Track>,
    val total: Int,
    val hasMore: Boolean,
)

data class PlaybackTarget(
    val primaryUrl: String,
    val fallbackUrl: String? = null,
    val usesServerProxy: Boolean = false,
)

class ApiException(val statusCode: Int, message: String) : IOException(message)

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

    suspend fun currentProfile(server: ServerAddress): AccountProfile? = withContext(Dispatchers.IO) {
        executeRequest(
            Request.Builder().url(server.api("auth", "me")).get().build(),
            "current profile",
            allowNoContent = true,
        )?.toAccountProfile()
    }

    suspend fun updateNickname(server: ServerAddress, nickname: String): AccountProfile =
        profileRequest(server, listOf("auth", "me"), "PATCH", JSONObject().put("nickname", nickname), "update nickname")

    suspend fun uploadAvatar(server: ServerAddress, image: String): AccountProfile =
        profileRequest(server, listOf("auth", "me", "avatar"), "POST", JSONObject().put("image", image), "upload avatar")

    suspend fun setInitialPassword(server: ServerAddress, password: String) = withContext(Dispatchers.IO) {
        jsonRequest(server, listOf("auth", "me", "password"), "POST", JSONObject().put("password", password), "set password")
    }

    suspend fun updateAccountId(
        server: ServerAddress,
        accountId: String,
        currentPassword: String?,
    ): AccountProfile = withContext(Dispatchers.IO) {
        val body = JSONObject().put("accountId", accountId)
        if (!currentPassword.isNullOrBlank()) body.put("currentPassword", currentPassword)
        requireNotNull(jsonRequest(server, listOf("auth", "me", "account-id"), "PATCH", body, "update account ID"))
            .toAccountProfile()
    }

    suspend fun recoverIdentity(server: ServerAddress, accountId: String, password: String): String =
        withContext(Dispatchers.IO) {
            requireNotNull(
                jsonRequest(
                    server,
                    listOf("auth", "identity", "recover"),
                    "POST",
                    JSONObject().put("accountId", accountId).put("password", password),
                    "recover identity",
                ),
            ).getString("userId")
        }

    suspend fun logoutIdentity(server: ServerAddress): String = withContext(Dispatchers.IO) {
        requireNotNull(
            jsonRequest(server, listOf("auth", "identity", "logout"), "POST", JSONObject(), "logout identity"),
        ).getString("userId")
    }

    suspend fun adminUsers(server: ServerAddress): List<AdminUser> = withContext(Dispatchers.IO) {
        val array = requireNotNull(jsonRequest(server, listOf("admin", "users"), "GET", null, "admin users"))
            .optJSONArray("users") ?: JSONArray()
        List(array.length()) { index -> array.getJSONObject(index).toAdminUser() }
    }

    suspend fun adminRooms(server: ServerAddress): List<AdminRoom> = withContext(Dispatchers.IO) {
        val array = requireNotNull(jsonRequest(server, listOf("admin", "rooms"), "GET", null, "admin rooms"))
            .optJSONArray("rooms") ?: JSONArray()
        List(array.length()) { index -> array.getJSONObject(index).toAdminRoom() }
    }

    suspend fun adminAudioProxyPolicy(server: ServerAddress): AudioProxyPolicy = withContext(Dispatchers.IO) {
        requireNotNull(
            jsonRequest(server, listOf("admin", "audio-proxy-policy"), "GET", null, "admin audio proxy policy"),
        ).toAudioProxyPolicy()
    }

    suspend fun updateAdminAudioProxyPolicy(
        server: ServerAddress,
        kugouForceProxy: Boolean,
    ): AudioProxyPolicy = withContext(Dispatchers.IO) {
        val body = JSONObject().put("kugouForceProxy", kugouForceProxy)
        requireNotNull(
            jsonRequest(server, listOf("admin", "audio-proxy-policy"), "PATCH", body, "update audio proxy policy"),
        ).toAudioProxyPolicy()
    }

    suspend fun deleteAdminUser(server: ServerAddress, userId: String) = withContext(Dispatchers.IO) {
        jsonRequest(server, listOf("admin", "users", userId), "DELETE", null, "delete user", allowNoContent = true)
    }

    suspend fun resetAdminPassword(server: ServerAddress, userId: String, password: String) =
        withContext(Dispatchers.IO) {
            jsonRequest(
                server,
                listOf("admin", "users", userId, "reset-password"),
                "POST",
                JSONObject().put("password", password),
                "reset password",
                allowNoContent = true,
            )
        }

    suspend fun dissolveAdminRoom(server: ServerAddress, roomId: String) = withContext(Dispatchers.IO) {
        jsonRequest(
            server,
            listOf("admin", "rooms", roomId, "dissolve"),
            "POST",
            JSONObject(),
            "dissolve room",
            allowNoContent = true,
        )
    }

    fun resolveResource(server: ServerAddress, path: String?): String? {
        if (path.isNullOrBlank()) return null
        return if (path.startsWith("/")) server.httpBase.resolve(path)?.toString() else path
    }

    fun playbackUrl(server: ServerAddress, track: Track, roomId: String? = null): String? {
        return playbackTarget(server, track, roomId, AudioProxyPolicy())?.primaryUrl
    }

    fun playbackTarget(
        server: ServerAddress,
        track: Track,
        roomId: String? = null,
        policy: AudioProxyPolicy,
    ): PlaybackTarget? {
        val streamUrl = track.streamUrl ?: return null
        val proxyUrl = when {
            track.source == "bilibili" && track.urlId.isNotBlank() ->
                server.api("music", "bilibili-audio-proxy").newBuilder()
                    .addQueryParameter("url", streamUrl)
                    .addQueryParameter("bvid", track.urlId)
                    .apply { roomId?.takeIf { it.isNotBlank() }?.let { addQueryParameter("roomId", it) } }
                    .build()
                    .toString()
            track.source == "kugou" || track.source == "kugou_concept" ->
                server.api("music", "kugou-audio-proxy").newBuilder()
                    .addQueryParameter("url", streamUrl)
                    .build()
                    .toString()
            else -> null
        }
        val forceProxy = when (track.source) {
            "bilibili" -> true
            "kugou", "kugou_concept" -> policy.kugouForceProxy
            else -> false
        }
        return if ((forceProxy || track.requiresServerProxy) && proxyUrl != null) {
            PlaybackTarget(primaryUrl = proxyUrl, usesServerProxy = true)
        } else {
            PlaybackTarget(primaryUrl = streamUrl, fallbackUrl = proxyUrl)
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

    suspend fun bilibiliCollection(server: ServerAddress, bvid: String): BilibiliCollectionPage =
        withContext(Dispatchers.IO) {
            val url = server.api("music", "bilibili-collection").newBuilder()
                .addQueryParameter("bvid", bvid.substringBefore('?'))
                .build()
            val json = executeJson(url, "bilibili collection")
            val tracks = json.optJSONArray("tracks")?.let { array ->
                List(array.length()) { array.getJSONObject(it).toTrack() }
            }.orEmpty()
            BilibiliCollectionPage(
                title = json.optString("title"),
                tracks = tracks,
            )
        }

    suspend fun recommendations(
        server: ServerAddress,
        roomId: String,
        limit: Int = 50,
    ): List<PlatformRecommendation> = withContext(Dispatchers.IO) {
        val url = server.api("music", "recommendations").newBuilder()
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("limit", limit.coerceIn(1, 50).toString())
            .build()
        parsePlatformRecommendations(executeJson(url, "recommendations"))
    }

    suspend fun lyrics(server: ServerAddress, track: Track): JSONObject? = withContext(Dispatchers.IO) {
        val lyricId = track.lyricId?.takeIf { it.isNotBlank() } ?: return@withContext null
        val source = track.metadataSource ?: track.source
        val url = server.api("music", "lyric").newBuilder()
            .addQueryParameter("source", source)
            .addQueryParameter("lyricId", lyricId)
            .build()
        executeJson(url, "lyrics:$source")
    }

    suspend fun playlist(
        server: ServerAddress,
        source: String,
        id: String,
        roomId: String,
        offset: Int,
        total: Int?,
        limit: Int = 100,
    ): PlaylistPage = withContext(Dispatchers.IO) {
        val url = server.api("music", "playlist").newBuilder()
            .addQueryParameter("source", source)
            .addQueryParameter("id", id)
            .addQueryParameter("limit", limit.toString())
            .addQueryParameter("offset", offset.toString())
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("type", "playlist")
            .apply { total?.takeIf { it > 0 }?.let { addQueryParameter("total", it.toString()) } }
            .build()
        val json = executeJson(url, "playlist:$source")
        val tracks = json.optJSONArray("tracks")?.let { array ->
            List(array.length()) { array.getJSONObject(it).toTrack() }
        }.orEmpty()
        PlaylistPage(
            tracks = tracks,
            total = json.optInt("total", tracks.size),
            hasMore = json.optBoolean("hasMore", false),
        )
    }

    suspend fun ttml(track: Track): String? = withContext(Dispatchers.IO) {
        val source = track.metadataSource ?: track.source
        val lyricTrackId = if (track.metadataSource != null) track.lyricId else track.sourceId
        if (lyricTrackId.isNullOrBlank()) return@withContext null
        val folder = when (source) {
            "netease" -> "ncm-lyrics"
            "tencent" -> "qq-lyrics"
            else -> return@withContext null
        }
        val url = "https://amlldb.bikonoo.com/$folder/$lyricTrackId.ttml"
        val request = Request.Builder().url(url).get().build()
        val ttmlClient = client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
        AppLogger.info("HTTP", "GET TTML source=$source sourceId=$lyricTrackId")
        ttmlClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                AppLogger.warn("HTTP", "TTML status=${response.code}")
                return@withContext null
            }
            response.body?.string()?.takeIf { it.contains("<tt") }
        }
    }

    private suspend fun profileRequest(
        server: ServerAddress,
        segments: List<String>,
        method: String,
        body: JSONObject,
        label: String,
    ): AccountProfile = withContext(Dispatchers.IO) {
        requireNotNull(jsonRequest(server, segments, method, body, label)).toAccountProfile()
    }

    private fun jsonRequest(
        server: ServerAddress,
        segments: List<String>,
        method: String,
        body: JSONObject?,
        label: String,
        allowNoContent: Boolean = false,
    ): JSONObject? {
        val requestBody = body?.toString()?.toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url(server.api(*segments.toTypedArray()))
            .method(method, when {
                method == "GET" || method == "DELETE" -> null
                requestBody != null -> requestBody
                else -> ByteArray(0).toRequestBody()
            })
            .build()
        return executeRequest(request, label, allowNoContent)
    }

    private fun executeJson(url: HttpUrl, label: String): JSONObject {
        val request = Request.Builder().url(url).get().build()
        return requireNotNull(executeRequest(request, label))
    }

    private fun executeRequest(request: Request, label: String, allowNoContent: Boolean = false): JSONObject? {
        val requestClient = client.newBuilder().callTimeout(60, TimeUnit.SECONDS).build()
        AppLogger.info("HTTP", "${request.method} ${request.url.encodedPath} label=$label")
        requestClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                AppLogger.warn("HTTP", "$label status=${response.code} body=${body.take(300)}")
                val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "请求失败（HTTP ${response.code}）"
                throw ApiException(response.code, message)
            }
            if (response.code == 204 || body.isBlank()) {
                if (allowNoContent || response.code == 204) return null
                throw IOException("服务端未返回数据")
            }
            val json = runCatching { JSONObject(body) }.getOrElse {
                AppLogger.error("HTTP", "$label returned invalid JSON: ${body.take(300)}", it)
                throw IOException("服务端返回了无法解析的数据")
            }
            AppLogger.info("HTTP", "$label status=${response.code} items=${json.optJSONArray("tracks")?.length() ?: "n/a"}")
            return json
        }
    }

    private fun JSONObject.toAccountProfile() = AccountProfile(
        id = optString("id"),
        nickname = optString("nickname"),
        avatarUrl = stringOrNull("avatarUrl"),
        hasPassword = optBoolean("hasPassword"),
        role = optString("role", "user"),
    )

    private fun JSONObject.toAdminUser() = AdminUser(
        id = optString("id"),
        nickname = optString("nickname"),
        avatarUrl = stringOrNull("avatarUrl"),
        role = optString("role", "user"),
        hasPassword = optBoolean("hasPassword"),
        createdAt = optLong("createdAt"),
        updatedAt = optLong("updatedAt"),
        lastSeenAt = optLong("lastSeenAt"),
    )

    private fun JSONObject.toAdminRoom() = AdminRoom(
        id = optString("id"),
        name = optString("name"),
        creatorId = optString("creatorId"),
        userCount = optInt("userCount"),
        hasPassword = optBoolean("hasPassword"),
        hidden = optBoolean("hidden", false),
        permanent = optBoolean("permanent", false),
        currentTrackTitle = stringOrNull("currentTrackTitle"),
    )

    private fun JSONObject.toAudioProxyPolicy() = AudioProxyPolicy(
        kugouForceProxy = optBoolean("kugouForceProxy", true),
    )

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

internal fun parsePlatformRecommendations(json: JSONObject): List<PlatformRecommendation> {
    val recommendations = json.optJSONArray("recommendations") ?: JSONArray()
    return List(recommendations.length()) { index ->
        val recommendation = recommendations.getJSONObject(index)
        val tracks = recommendation.optJSONArray("tracks") ?: JSONArray()
        PlatformRecommendation(
            platform = recommendation.optString("platform"),
            tracks = List(tracks.length()) { trackIndex -> tracks.getJSONObject(trackIndex).toTrack() },
            unavailableReason = recommendation.stringOrNull("unavailableReason"),
        )
    }.filter { it.platform.isNotBlank() }
}
