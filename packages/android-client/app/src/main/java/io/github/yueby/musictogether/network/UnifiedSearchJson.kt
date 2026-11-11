package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.UnifiedSearchGroup
import io.github.yueby.musictogether.model.queueIdentity
import org.json.JSONObject

internal fun parseUnifiedSearch(json: JSONObject): SearchPage {
    val raw = json.optJSONArray("groups")
    val groups = buildList {
        repeat(raw?.length() ?: 0) { index ->
            val group = raw?.optJSONObject(index) ?: return@repeat
            val candidates = group.optJSONArray("candidates") ?: return@repeat
            val tracks = (0 until candidates.length()).mapNotNull { candidates.optJSONObject(it)?.toTrack() }
                .filter { it.source in setOf("netease", "tencent", "kugou", "kugou_concept") && it.sourceId.isNotBlank() }
                .distinctBy { it.queueIdentity() }
            if (tracks.isEmpty()) return@repeat
            val artists = group.optJSONArray("artist")
            add(UnifiedSearchGroup(
                key = group.stringOrNull("key") ?: "group-$index",
                title = group.stringOrNull("title") ?: tracks.first().title,
                artist = artists?.let { List(it.length()) { index -> it.optString(index) } } ?: tracks.first().artist,
                duration = group.optDouble("duration", tracks.first().duration),
                version = group.stringOrNull("version"),
                candidates = tracks,
            ))
        }
    }
    val failed = json.optJSONArray("failedSources")
    return SearchPage(
        tracks = groups.flatMap { it.candidates }, page = 1, hasMore = false, groups = groups,
        failedSources = failed?.let { List(it.length()) { index -> it.optString(index) } }.orEmpty(),
    )
}
