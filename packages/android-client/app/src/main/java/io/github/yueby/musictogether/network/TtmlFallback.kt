package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException

internal fun ttmlFallbackUrls(server: ServerAddress, track: Track): List<HttpUrl> {
    val source = track.metadataSource ?: track.source
    val id = (if (track.metadataSource != null) track.lyricId else track.sourceId)?.takeIf { it.isNotBlank() }
        ?: return emptyList()
    val platform = when (source) { "netease" -> "ncm"; "tencent" -> "qq"; else -> return emptyList() }
    val folder = if (platform == "ncm") "ncm-lyrics" else "qq-lyrics"
    val legacy = "https://amlldb.bikonoo.com/".toHttpUrl().newBuilder()
        .addPathSegment(folder).addPathSegment("$id.ttml").build()
    val proxy = server.api("music", "ttml").newBuilder().addQueryParameter("url", legacy.toString()).build()
    val amll = server.api("music", "amll-ttml").newBuilder()
        .addQueryParameter("platform", platform).addQueryParameter("id", id.take(200))
        .apply {
            if (track.title.isNotBlank()) addQueryParameter("title", track.title.take(300))
            track.artist.filter { it.isNotBlank() }.take(10).forEach { addQueryParameter("artists", it.take(200)) }
            if (track.album.isNotBlank()) addQueryParameter("album", track.album.take(300))
            if (track.duration.isFinite() && track.duration > 0 && track.duration <= 86_400) {
                addQueryParameter("duration", track.duration.toString())
            }
        }.build()
    return listOf(proxy, amll, legacy)
}

/** Keep the whole fallback chain inside the original eight-second lyric budget. */
internal suspend fun loadTtmlWithFallback(urls: List<HttpUrl>, fetch: suspend (HttpUrl) -> String?): String? =
    withTimeoutOrNull(8_000L) {
        for (url in urls) {
            val text = try {
                withTimeoutOrNull(3_000L) { fetch(url) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: IOException) {
                null
            }
            if (text != null && Regex("<tt(?:\\s|>)").containsMatchIn(text)) return@withTimeoutOrNull text
        }
        null
    }
