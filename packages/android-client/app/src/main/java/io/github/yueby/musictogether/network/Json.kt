package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.ClientInfo
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.PlatformAuthStatus
import io.github.yueby.musictogether.model.MyPlatformAuth
import io.github.yueby.musictogether.model.RoomMember
import io.github.yueby.musictogether.model.RoomListItem
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.User
import io.github.yueby.musictogether.model.VoteState
import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.stringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) optString(name).takeIf { it.isNotBlank() } else null

internal fun JSONObject.audioQuality(name: String, fallback: String = "320"): String {
    if (!has(name) || isNull(name)) return fallback
    return when (val value = opt(name)) {
        is Number -> value.toInt().toString()
        is String -> value.takeIf { it.isNotBlank() } ?: fallback
        else -> fallback
    }
}

internal fun JSONObject.toTrack(): Track {
    val artists = optJSONArray("artist")
    val artistList = when {
        artists != null -> List(artists.length()) { artists.optString(it) }
        stringOrNull("artist") != null -> listOfNotNull(stringOrNull("artist"))
        else -> emptyList()
    }
    return Track(
        id = optString("id"),
        title = optString("title", "未知歌曲"),
        artist = artistList,
        album = optString("album"),
        duration = optDouble("duration", 0.0),
        cover = optString("cover"),
        source = optString("source", "netease"),
        sourceId = optString("sourceId"),
        urlId = optString("urlId"),
        lyricId = stringOrNull("lyricId"),
        picId = stringOrNull("picId"),
        bilibiliCover = stringOrNull("bilibiliCover"),
        metadataSource = stringOrNull("metadataSource"),
        streamUrl = stringOrNull("streamUrl"),
        requiresServerProxy = optBoolean("requiresServerProxy", false),
        streamFormat = stringOrNull("streamFormat"),
        vip = optBoolean("vip", false),
        requestedBy = stringOrNull("requestedBy"),
    )
}

internal fun Track.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("artist", JSONArray(artist))
    put("album", album)
    put("duration", duration)
    put("cover", cover)
    put("source", source)
    put("sourceId", sourceId)
    put("urlId", urlId)
    lyricId?.let { put("lyricId", it) }
    picId?.let { put("picId", it) }
    bilibiliCover?.let { put("bilibiliCover", it) }
    metadataSource?.let { put("metadataSource", it) }
    streamUrl?.let { put("streamUrl", it) }
    put("requiresServerProxy", requiresServerProxy)
    streamFormat?.let { put("streamFormat", it) }
    put("vip", vip)
    requestedBy?.let { put("requestedBy", it) }
}

internal fun JSONObject.toPlayState(): PlayState = PlayState(
    isPlaying = optBoolean("isPlaying", false),
    currentTime = optDouble("currentTime", 0.0),
    serverTimestamp = optLong("serverTimestamp", 0L),
    serverTimeToExecute = if (has("serverTimeToExecute")) optLong("serverTimeToExecute") else null,
)

internal fun JSONObject.toUser(): User = User(
    id = optString("id"),
    nickname = optString("nickname"),
    role = optString("role", "member"),
    avatarUrl = stringOrNull("avatarUrl"),
    isServerAdmin = optBoolean("isServerAdmin", false),
    client = optJSONObject("client")?.toClientInfo(),
    clients = optJSONArray("clients")?.toClientInfos().orEmpty(),
)

internal fun JSONObject.toClientInfo(): ClientInfo? {
    val label = stringOrNull("label") ?: return null
    return ClientInfo(
        kind = stringOrNull("kind") ?: "web",
        label = label,
        count = if (has("count") && !isNull("count")) optInt("count").takeIf { it > 1 } else null,
    )
}

internal fun JSONArray.toClientInfos(): List<ClientInfo> = buildList {
    for (index in 0 until length()) {
        optJSONObject(index)?.toClientInfo()?.let(::add)
    }
}

internal fun JSONObject.toRoomMember(): RoomMember = RoomMember(
    id = optString("id"),
    nickname = optString("nickname"),
    role = optString("role", "member"),
    avatarUrl = stringOrNull("avatarUrl"),
    isServerAdmin = optBoolean("isServerAdmin", false),
    client = optJSONObject("client")?.toClientInfo(),
    clients = optJSONArray("clients")?.toClientInfos().orEmpty(),
    isOnline = optBoolean("isOnline", false),
    joinedAt = optLong("joinedAt", 0L),
    lastSeenAt = if (has("lastSeenAt") && !isNull("lastSeenAt")) optLong("lastSeenAt") else null,
)

internal fun JSONObject.toRoomState(): RoomState {
    val usersJson = optJSONArray("users") ?: JSONArray()
    val users = List(usersJson.length()) { i -> usersJson.getJSONObject(i).toUser() }
    val membersJson = optJSONArray("members")
    val queueJson = optJSONArray("queue") ?: JSONArray()
    val current = optJSONObject("currentTrack")
    return RoomState(
        id = optString("id"),
        name = optString("name", "Music Together"),
        creatorId = optString("creatorId"),
        hostId = optString("hostId"),
        temporaryAdminUserId = stringOrNull("temporaryAdminUserId"),
        hasPassword = optBoolean("hasPassword", false),
        hidden = optBoolean("hidden", false),
        permanent = optBoolean("permanent", false),
        allowTemporaryAdminTrackRemoval = optBoolean("allowTemporaryAdminTrackRemoval", false),
        allowTemporaryAdminQueueClear = optBoolean("allowTemporaryAdminQueueClear", false),
        audioQuality = audioQuality("audioQuality"),
        users = users,
        members = membersJson?.let { value ->
            List(value.length()) { index -> value.getJSONObject(index).toRoomMember() }
        } ?: users.map { user ->
            RoomMember(
                id = user.id,
                nickname = user.nickname,
                role = user.role,
                avatarUrl = user.avatarUrl,
                isServerAdmin = user.isServerAdmin,
                client = user.client,
                clients = user.clients,
                isOnline = true,
                joinedAt = 0L,
            )
        },
        queue = List(queueJson.length()) { queueJson.getJSONObject(it).toTrack() },
        currentTrack = current?.toTrack(),
        playState = (optJSONObject("playState") ?: JSONObject()).toPlayState(),
        playMode = optString("playMode", "sequential"),
    )
}

internal fun JSONArray.toRoomList(): List<RoomListItem> = List(length()) { i ->
    val item = getJSONObject(i)
    RoomListItem(
        id = item.optString("id"),
        name = item.optString("name", "未命名房间"),
        hasPassword = item.optBoolean("hasPassword"),
        permanent = item.optBoolean("permanent", false),
        userCount = item.optInt("userCount"),
        currentTrackTitle = item.stringOrNull("currentTrackTitle"),
        currentTrackArtist = item.stringOrNull("currentTrackArtist"),
    )
}

internal fun JSONObject.toChatMessage(): ChatMessage = ChatMessage(
    id = optString("id"),
    userId = optString("userId"),
    nickname = optString("nickname"),
    content = optString("content"),
    timestamp = optLong("timestamp"),
    type = optString("type", "user"),
)

internal fun JSONObject.toVoteState(): VoteState = VoteState(
    id = optString("id"),
    action = optString("action"),
    initiatorId = optString("initiatorId"),
    initiatorNickname = optString("initiatorNickname"),
    votes = optJSONObject("votes")?.let { value ->
        value.keys().asSequence().associateWith { value.optBoolean(it) }
    }.orEmpty(),
    requiredVotes = optInt("requiredVotes"),
    totalUsers = optInt("totalUsers"),
    expiresAt = optLong("expiresAt"),
    payload = optJSONObject("payload")?.let { value ->
        value.keys().asSequence().associateWith { value.optString(it) }
    }.orEmpty(),
)

internal fun JSONObject.toPlatformAuthStatus(): PlatformAuthStatus = PlatformAuthStatus(
    platform = optString("platform"),
    loggedInCount = optInt("loggedInCount"),
    hasVip = optBoolean("hasVip"),
    maxVipType = optInt("maxVipType"),
    maxVipLabel = stringOrNull("maxVipLabel"),
    maxVipLevel = if (has("maxVipLevel") && !isNull("maxVipLevel")) optInt("maxVipLevel") else null,
)

internal fun JSONObject.toMyPlatformAuth(): MyPlatformAuth = MyPlatformAuth(
    platform = optString("platform"),
    loggedIn = optBoolean("loggedIn"),
    nickname = stringOrNull("nickname"),
    vipType = optInt("vipType"),
    vipLabel = stringOrNull("vipLabel"),
    vipLevel = if (has("vipLevel") && !isNull("vipLevel")) optInt("vipLevel") else null,
)

internal fun JSONObject.toPlaylist(): Playlist = Playlist(
    id = optString("id"),
    name = optString("name", "未命名歌单"),
    cover = optString("cover"),
    trackCount = optInt("trackCount"),
    source = optString("source"),
    creator = stringOrNull("creator"),
    description = stringOrNull("description"),
)
