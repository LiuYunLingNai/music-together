package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.UserPlaylist
import io.github.yueby.musictogether.model.UserPlaylistDetail
import org.json.JSONObject

internal fun JSONObject.toUserPlaylist(): UserPlaylist = UserPlaylist(
    id = optString("id"),
    name = optString("name", "未命名歌单"),
    cover = stringOrNull("cover"),
    trackCount = optInt("trackCount"),
    createdAt = optLong("createdAt"),
    updatedAt = optLong("updatedAt"),
)

internal fun JSONObject.toUserPlaylistDetail(): UserPlaylistDetail {
    val tracks = optJSONArray("tracks")
    return UserPlaylistDetail(
        playlist = toUserPlaylist(),
        tracks = if (tracks == null) emptyList() else List(tracks.length()) { tracks.getJSONObject(it).toTrack() },
    )
}

internal fun parseUserPlaylists(json: JSONObject): List<UserPlaylist> {
    val array = json.optJSONArray("playlists") ?: return emptyList()
    return List(array.length()) { array.getJSONObject(it).toUserPlaylist() }
}
