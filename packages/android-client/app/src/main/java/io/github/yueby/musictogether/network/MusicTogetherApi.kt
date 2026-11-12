package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.UserPlaylistDetail
import io.github.yueby.musictogether.model.UserPlaylist
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.ArtistHome
import io.github.yueby.musictogether.model.CatalogPage
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.DiscoverHome
import io.github.yueby.musictogether.model.AccountProfile
import io.github.yueby.musictogether.model.AdminRoom
import io.github.yueby.musictogether.model.AdminUser
import io.github.yueby.musictogether.model.AudioProxyPolicy
import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UnifiedSearchGroup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
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
    val groups: List<UnifiedSearchGroup> = emptyList(),
    val failedSources: List<String> = emptyList(),
)

data class BilibiliCollectionPage(
    val title: String,
    val tracks: List<Track>,
)

data class HotSongsPage(
    val name: String,
    val tracks: List<Track>,
    val hasMore: Boolean,
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
    private suspend fun <T> Call.readCancellable(read: (Response) -> T): T =
        suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancel() }
            enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    continuation.resumeWith(Result.failure(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    val result = runCatching {
                        response.use {
                            if (!continuation.isActive) throw IOException("Request cancelled")
                            read(it)
                        }
                    }
                    continuation.resumeWith(result)
                }
            })
        }

    suspend fun bootstrapIdentity(server: ServerAddress): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(server.api("auth", "identity", "bootstrap"))
            .post(ByteArray(0).toRequestBody())
            .build()
        AppLogger.info("HTTP", "POST ${request.url.encodedPath}")
        client.newCall(request).readCancellable { response ->
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

    suspend fun streamUrl(server: ServerAddress, track: Track, bitrate: String, roomId: String? = null): String? =
        withContext(Dispatchers.IO) {
            if (track.urlId.isBlank()) return@withContext null
            val url = streamRequestUrl(server, track, bitrate, roomId)
            executeJson(url, "stream URL:${track.source}").stringOrNull("url")
        }

    suspend fun search(server: ServerAddress, keyword: String, source: String, roomId: String?, page: Int): SearchPage =
        withContext(Dispatchers.IO) {
            if (source == "all") {
                val url = server.api("music", "search-all").newBuilder()
                    .addQueryParameter("keyword", normalizeSearchKeyword(keyword, source))
                    .addQueryParameter("limit", "10")
                    .apply { if (!roomId.isNullOrBlank()) addQueryParameter("roomId", roomId) }
                    .build()
                return@withContext parseUnifiedSearch(executeJson(url, "search:all"))
            }
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
        radarPage: Int = 1,
        playlistOffset: Int = 0,
    ): List<PlatformRecommendation> = withContext(Dispatchers.IO) {
        val url = server.api("music", "recommendations").newBuilder()
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("limit", limit.coerceIn(1, 50).toString())
            .addQueryParameter("radarPage", radarPage.coerceAtLeast(1).toString())
            .addQueryParameter("playlistOffset", playlistOffset.coerceAtLeast(0).toString())
            .build()
        parsePlatformRecommendations(executeJson(url, "recommendations"))
    }

    suspend fun artistHome(server: ServerAddress, source: String, id: String): ArtistHome = withContext(Dispatchers.IO) {
        val url = server.api("music", "artist").newBuilder()
            .addQueryParameter("source", source)
            .addQueryParameter("id", id)
            .build()
        parseArtistHome(executeJson(url, "artist:$source"))
    }

    suspend fun artistSongs(server: ServerAddress, source: String, id: String, offset: Int, limit: Int): CatalogPage<Track> =
        withContext(Dispatchers.IO) {
            val url = server.api("music", "artist", "songs").newBuilder()
                .addQueryParameter("source", source)
                .addQueryParameter("id", id)
                .addQueryParameter("offset", offset.toString())
                .addQueryParameter("limit", limit.toString())
                .build()
            parseArtistSongs(executeJson(url, "artist-songs:$source"))
        }

    suspend fun artistAlbums(server: ServerAddress, source: String, id: String, offset: Int, limit: Int): CatalogPage<Playlist> =
        withContext(Dispatchers.IO) {
            val url = server.api("music", "artist", "albums").newBuilder()
                .addQueryParameter("source", source)
                .addQueryParameter("id", id)
                .addQueryParameter("offset", offset.toString())
                .addQueryParameter("limit", limit.toString())
                .build()
            parseArtistAlbums(executeJson(url, "artist-albums:$source"))
        }

    suspend fun discoverHome(server: ServerAddress, source: String): DiscoverHome = withContext(Dispatchers.IO) {
        val url = server.api("music", "discover", "home").newBuilder()
            .addQueryParameter("source", source)
            .build()
        parseDiscoverHome(executeJson(url, "discover:$source"))
    }

    suspend fun userPlaylists(server: ServerAddress): List<UserPlaylist> = withContext(Dispatchers.IO) {
        parseUserPlaylists(requireNotNull(jsonRequest(server, listOf("playlists"), "GET", null, "user playlists")))
    }

    suspend fun userPlaylist(server: ServerAddress, id: String): UserPlaylistDetail = withContext(Dispatchers.IO) {
        requireNotNull(jsonRequest(server, listOf("playlists", id), "GET", null, "user playlist"))
            .getJSONObject("playlist")
            .toUserPlaylistDetail()
    }

    suspend fun createUserPlaylist(server: ServerAddress, name: String): UserPlaylist = withContext(Dispatchers.IO) {
        requireNotNull(jsonRequest(server, listOf("playlists"), "POST", JSONObject().put("name", name), "create user playlist"))
            .getJSONObject("playlist")
            .toUserPlaylist()
    }

    suspend fun renameUserPlaylist(server: ServerAddress, id: String, name: String): UserPlaylist =
        withContext(Dispatchers.IO) {
            requireNotNull(
                jsonRequest(server, listOf("playlists", id), "PATCH", JSONObject().put("name", name), "rename user playlist"),
            ).getJSONObject("playlist").toUserPlaylist()
        }

    suspend fun deleteUserPlaylist(server: ServerAddress, id: String) = withContext(Dispatchers.IO) {
        jsonRequest(server, listOf("playlists", id), "DELETE", null, "delete user playlist", allowNoContent = true)
    }

    suspend fun addUserPlaylistTracks(server: ServerAddress, id: String, tracks: List<Track>): Int =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("tracks", JSONArray(tracks.map { it.toJson() }))
            requireNotNull(jsonRequest(server, listOf("playlists", id, "tracks"), "POST", body, "add user playlist tracks"))
                .optInt("added")
        }

    suspend fun removeUserPlaylistTrack(server: ServerAddress, id: String, trackId: String) = withContext(Dispatchers.IO) {
        jsonRequest(
            server,
            listOf("playlists", id, "tracks", trackId),
            "DELETE",
            null,
            "remove user playlist track",
            allowNoContent = true,
        )
    }

    suspend fun hotSongs(
        server: ServerAddress,
        roomId: String,
        source: String,
        offset: Int,
        refresh: Boolean,
        limit: Int = 30,
    ): HotSongsPage = withContext(Dispatchers.IO) {
        val url = server.api("music", "hot").newBuilder()
            .addQueryParameter("roomId", roomId)
            .addQueryParameter("source", source)
            .addQueryParameter("limit", limit.toString())
            .addQueryParameter("offset", offset.toString())
            .apply { if (refresh) addQueryParameter("refresh", "true") }
            .build()
        val json = executeJson(url, "hot:$source")
        val tracks = json.optJSONArray("tracks")?.let { array -> List(array.length()) { array.getJSONObject(it).toTrack() } }.orEmpty()
        HotSongsPage(
            name = json.optString("name", "热歌榜"),
            tracks = tracks,
            hasMore = json.optBoolean("hasMore", false),
        )
    }

    suspend fun dynamicCover(server: ServerAddress, track: Track, roomId: String): String? = withContext(Dispatchers.IO) {
        val url = server.api("music", "dynamic-cover").newBuilder()
            .addQueryParameter("source", track.source)
            .addQueryParameter("id", track.urlId)
            .addQueryParameter("roomId", roomId)
            .apply {
                track.title.takeIf(String::isNotBlank)?.let { addQueryParameter("title", it) }
                track.artist.filter(String::isNotBlank).take(10).forEach { addQueryParameter("artists", it) }
                track.album.takeIf(String::isNotBlank)?.let { addQueryParameter("album", it) }
                if (track.duration > 0) addQueryParameter("duration", track.duration.toString())
            }
            .build()
        executeJson(url, "dynamic-cover").optString("url").takeIf { it.startsWith("http") }
    }

    suspend fun isLiked(server: ServerAddress, track: Track, roomId: String): Boolean = withContext(Dispatchers.IO) {
        val url = server.api("music", "liked").newBuilder()
            .addQueryParameter("source", track.source)
            .addQueryParameter("id", track.sourceId.ifBlank { track.id })
            .addQueryParameter("roomId", roomId)
            .build()
        executeJson(url, "liked").optBoolean("liked", false)
    }

    suspend fun setLiked(server: ServerAddress, track: Track, roomId: String, liked: Boolean): Boolean =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("source", track.source)
                .put("id", track.sourceId.ifBlank { track.id })
                .put("roomId", roomId)
                .put("liked", liked)
            requireNotNull(jsonRequest(server, listOf("music", "liked"), "POST", body, "set liked")).optBoolean("liked", liked)
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

    suspend fun lyricSupplement(server: ServerAddress, track: Track): JSONObject? = withContext(Dispatchers.IO) {
        val lyricId = track.lyricId?.takeIf { it.isNotBlank() } ?: return@withContext null
        val url = server.api("music", "lyric-supplement").newBuilder()
            .addQueryParameter("source", track.metadataSource ?: track.source)
            .addQueryParameter("lyricId", lyricId)
            .addQueryParameter("title", track.title)
            .addQueryParameter("duration", track.duration.toString())
            .apply { track.artist.forEach { addQueryParameter("artists", it) } }
            .build()
        executeJson(url, "lyric-supplement:" + track.source)
    }

    suspend fun playlist(
        server: ServerAddress,
        source: String,
        id: String,
        roomId: String?,
        offset: Int,
        total: Int?,
        limit: Int = 100,
        album: Boolean = false,
    ): PlaylistPage = withContext(Dispatchers.IO) {
        val url = server.api("music", "playlist").newBuilder()
            .addQueryParameter("source", source)
            .addQueryParameter("id", id)
            .addQueryParameter("limit", limit.toString())
            .addQueryParameter("offset", offset.toString())
            .apply { roomId?.takeIf { it.isNotBlank() }?.let { addQueryParameter("roomId", it) } }
            .addQueryParameter("type", if (album) "album" else "playlist")
            .apply { total?.takeIf { it > 0 }?.let { addQueryParameter("total", it.toString()) } }
            .build()
        val json = executeJson(url, "playlist:$source")
        val tracks = json.optJSONArray("tracks")?.let { array ->
            List(array.length()) { array.getJSONObject(it).toTrack() }
        }.orEmpty()
        val total = json.optInt("total", offset + tracks.size).coerceAtLeast(offset + tracks.size)
        PlaylistPage(
            tracks = tracks,
            total = total,
            hasMore = if (json.has("hasMore")) json.optBoolean("hasMore") else offset + tracks.size < total,
        )
    }

    suspend fun ttml(server: ServerAddress, track: Track): String? = withContext(Dispatchers.IO) {
        val ttmlClient = client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
        loadTtmlWithFallback(ttmlFallbackUrls(server, track)) { url ->
            val request = Request.Builder().url(url).get().build()
            ttmlClient.newCall(request).readCancellable { response ->
                if (!response.isSuccessful) return@readCancellable null
                val source = response.body?.source() ?: return@readCancellable null
                val maxBytes = 2 * 1024 * 1024L
                source.request(maxBytes + 1)
                if (source.buffer.size > maxBytes) return@readCancellable null
                source.readUtf8()
            }
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

    private suspend fun jsonRequest(
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

    private suspend fun executeJson(url: HttpUrl, label: String): JSONObject {
        val request = Request.Builder().url(url).get().build()
        return requireNotNull(executeRequest(request, label))
    }

    private suspend fun executeRequest(request: Request, label: String, allowNoContent: Boolean = false): JSONObject? {
        val timeout = if (label.startsWith("lyric") || label.startsWith("search")) 15L else 60L
        val requestClient = client.newBuilder().callTimeout(timeout, TimeUnit.SECONDS).build()
        AppLogger.info("HTTP", "${request.method} ${request.url.encodedPath} label=$label")
        return requestClient.newCall(request).readCancellable { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                AppLogger.warn("HTTP", "$label status=${response.code} body=${body.take(300)}")
                val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "请求失败（HTTP ${response.code}）"
                throw ApiException(response.code, message)
            }
            if (response.code == 204 || body.isBlank()) {
                if (allowNoContent || response.code == 204) return@readCancellable null
                throw IOException("服务端未返回数据")
            }
            val json = runCatching { JSONObject(body) }.getOrElse {
                AppLogger.error("HTTP", "$label returned invalid JSON: ${body.take(300)}", it)
                throw IOException("服务端返回了无法解析的数据")
            }
            AppLogger.info("HTTP", "$label status=${response.code} items=${json.optJSONArray("tracks")?.length() ?: "n/a"}")
            json
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
