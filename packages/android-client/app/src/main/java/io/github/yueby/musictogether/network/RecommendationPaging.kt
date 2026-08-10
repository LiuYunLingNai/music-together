package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.RecommendationPagination
import io.github.yueby.musictogether.model.RecommendationPlaylistPagination
import io.github.yueby.musictogether.model.RecommendationTrackPagination
import io.github.yueby.musictogether.model.queueIdentity
import org.json.JSONArray
import org.json.JSONObject

internal fun parsePlatformRecommendations(json: JSONObject): List<PlatformRecommendation> {
    val recommendations = json.optJSONArray("recommendations") ?: JSONArray()
    return List(recommendations.length()) { index ->
        val recommendation = recommendations.getJSONObject(index)
        val tracks = recommendation.optJSONArray("tracks") ?: JSONArray()
        val playlists = recommendation.optJSONArray("playlists") ?: JSONArray()
        PlatformRecommendation(
            platform = recommendation.optString("platform"),
            tracks = List(tracks.length()) { trackIndex -> tracks.getJSONObject(trackIndex).toTrack() },
            playlists = List(playlists.length()) { playlistIndex -> playlists.getJSONObject(playlistIndex).toPlaylist() },
            pagination = recommendation.optJSONObject("pagination")?.toRecommendationPagination(),
            unavailableReason = recommendation.stringOrNull("unavailableReason"),
        )
    }.filter { it.platform.isNotBlank() }
}

internal fun PlatformRecommendation.toJson(): JSONObject = JSONObject().apply {
    put("platform", platform)
    put("tracks", JSONArray(tracks.map { it.toJson() }))
    put("playlists", JSONArray(playlists.map { it.toJson() }))
    pagination?.let { value ->
        put("pagination", JSONObject().apply {
            value.tracks?.let {
                put("tracks", JSONObject().put("hasMore", it.hasMore).put("nextPage", it.nextPage))
            }
            value.playlists?.let {
                put("playlists", JSONObject().put("hasMore", it.hasMore).put("nextOffset", it.nextOffset))
            }
        })
    }
    unavailableReason?.let { put("unavailableReason", it) }
}

internal fun mergeTencentRecommendationPages(
    current: List<PlatformRecommendation>,
    incoming: List<PlatformRecommendation>,
): List<PlatformRecommendation> {
    val incomingTencent = incoming.firstOrNull { it.platform == "tencent" } ?: return current
    val currentTencent = current.firstOrNull { it.platform == "tencent" }
        ?: return current + incomingTencent
    val tracks = (currentTencent.tracks + incomingTencent.tracks).distinctBy { it.queueIdentity() }
    val playlists = (currentTencent.playlists + incomingTencent.playlists)
        .distinctBy { "${it.source}:${it.id}" }
    val merged = incomingTencent.copy(
        tracks = tracks,
        playlists = playlists,
        unavailableReason = incomingTencent.unavailableReason.takeIf { tracks.isEmpty() && playlists.isEmpty() },
    )
    return current.map { if (it.platform == "tencent") merged else it }
}

private fun JSONObject.toRecommendationPagination(): RecommendationPagination? {
    val trackValue = optJSONObject("tracks")?.let {
        RecommendationTrackPagination(
            hasMore = it.optBoolean("hasMore", false),
            nextPage = it.optInt("nextPage", 1).coerceAtLeast(1),
        )
    }
    val playlistValue = optJSONObject("playlists")?.let {
        RecommendationPlaylistPagination(
            hasMore = it.optBoolean("hasMore", false),
            nextOffset = it.optInt("nextOffset", 0).coerceAtLeast(0),
        )
    }
    return if (trackValue == null && playlistValue == null) null else RecommendationPagination(trackValue, playlistValue)
}

private fun Playlist.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("name", name)
    put("cover", cover)
    put("trackCount", trackCount)
    put("source", source)
    creator?.let { put("creator", it) }
    description?.let { put("description", it) }
}
