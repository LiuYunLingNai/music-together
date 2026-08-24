package io.github.yueby.musictogether.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class RoomJoinTarget(
    val roomId: String,
    val serverAddress: ServerAddress?,
)

object RoomJoinTargetParser {
    fun parse(value: String): RoomJoinTarget? {
        val input = value.trim()
        if (input.isEmpty()) return null

        parseBrowserIntent(input)?.let { return it }
        parseAppLink(input)?.let { return it }

        if (!input.contains("://")) {
            return RoomJoinTarget(roomId = input, serverAddress = null)
        }

        val url = input.toHttpUrlOrNull() ?: return null
        parseWebAppLink(url)?.let { return it }
        val pathSegments = url.pathSegments.dropLastWhile { it.isEmpty() }
        val encodedPathSegments = url.encodedPathSegments.dropLastWhile { it.isEmpty() }
        if (pathSegments.size < 2 || pathSegments[pathSegments.lastIndex - 1] != "room") return null

        val roomId = pathSegments.last()
        if (roomId.isBlank()) return null

        val serverBase = url.newBuilder()
            .encodedPath("/")
            .query(null)
            .fragment(null)
            .apply {
                encodedPathSegments.dropLast(2).filter { it.isNotEmpty() }.forEach(::addEncodedPathSegment)
            }
            .build()

        return RoomJoinTarget(roomId = roomId, serverAddress = ServerAddress(serverBase))
    }

    private fun parseAppLink(input: String): RoomJoinTarget? {
        if (!input.startsWith(RoomShareLink.SCHEME_PREFIX, ignoreCase = true)) return null
        val uri = runCatching { URI(input) }.getOrNull() ?: return null
        if (!uri.scheme.equals(RoomShareLink.SCHEME, ignoreCase = true) ||
            uri.host != RoomShareLink.HOST && uri.host != RoomShareLink.LEGACY_HOST
        ) {
            return null
        }
        val params = uri.rawQuery.orEmpty()
            .split('&')
            .mapNotNull { entry ->
                val separator = entry.indexOf('=')
                if (separator <= 0) return@mapNotNull null
                val key = decode(entry.substring(0, separator))
                val value = decode(entry.substring(separator + 1))
                key to value
            }
            .toMap()
        val roomId = params[RoomShareLink.ROOM_QUERY]?.trim().takeUnless { it.isNullOrBlank() }
            ?: params["room"]?.trim().orEmpty()
                .ifBlank { uri.path.orEmpty().trim('/').takeIf { uri.host == RoomShareLink.LEGACY_HOST }.orEmpty() }
        val server = params["server"]?.trim().orEmpty()
        if (roomId.isBlank() || server.isBlank()) return null
        val address = ServerAddress.parse(server) ?: return null
        return RoomJoinTarget(roomId = roomId, serverAddress = address)
    }

    private fun parseBrowserIntent(input: String): RoomJoinTarget? {
        if (!input.startsWith(RoomShareLink.INTENT_PREFIX, ignoreCase = true)) return null
        val suffix = input.substringAfter("#Intent;", missingDelimiterValue = "")
        if (!suffix.contains("scheme=${RoomShareLink.SCHEME};")) return null
        val appLink = RoomShareLink.SCHEME_PREFIX + input.substring(RoomShareLink.INTENT_PREFIX.length)
            .substringBefore("#Intent;")
        return parseAppLink(appLink)
    }

    private fun parseWebAppLink(url: okhttp3.HttpUrl): RoomJoinTarget? {
        if (url.scheme != "http" && url.scheme != "https") return null
        val pathSegments = url.pathSegments.dropLastWhile { it.isEmpty() }
        if (pathSegments.lastOrNull() != RoomShareLink.WEB_PATH_SEGMENT) return null

        val roomId = url.queryParameter(RoomShareLink.ROOM_QUERY)
            ?.trim()
            ?.takeIf(String::isNotBlank)
            ?: url.queryParameter("room")?.trim().orEmpty()
        if (roomId.isBlank()) return null

        // New links are served by the same server that owns the room. The
        // legacy official-domain format may still carry an explicit server.
        val server = url.queryParameter(RoomShareLink.SERVER_QUERY)
            ?.trim()
            ?.takeIf(String::isNotBlank)
            ?: url.newBuilder()
                .encodedPath("/")
                .query(null)
                .fragment(null)
                .apply {
                    url.encodedPathSegments
                        .dropLastWhile { it.isEmpty() }
                        .dropLast(1)
                        .filter { it.isNotEmpty() }
                        .forEach(::addEncodedPathSegment)
                }
                .build()
                .toString()
                .trimEnd('/')
        return RoomJoinTarget(roomId, ServerAddress.parse(server) ?: return null)
    }

    private fun decode(value: String): String =
        runCatching { URLDecoder.decode(value, StandardCharsets.UTF_8.name()) }.getOrDefault("")
}

object RoomShareLink {
    const val SCHEME = "musictogether"
    const val HOST = "join"
    const val LEGACY_HOST = "room"
    const val SCHEME_PREFIX = "$SCHEME://"
    const val INTENT_PREFIX = "intent://"
    const val WEB_PATH = "/join"
    const val WEB_PATH_SEGMENT = "join"
    const val ROOM_QUERY = "ROMMid"
    const val SERVER_QUERY = "server"

    fun buildWeb(server: ServerAddress, roomId: String): String {
        return "${server.displayUrl}$WEB_PATH?$ROOM_QUERY=${encode(roomId)}"
    }

    fun buildBrowserIntent(server: ServerAddress, roomId: String): String {
        val fallback = "${server.displayUrl}/room/${encodePathSegment(roomId)}"
        return "$INTENT_PREFIX$HOST?$ROOM_QUERY=${encode(roomId)}&$SERVER_QUERY=${encode(server.displayUrl)}" +
            "#Intent;scheme=$SCHEME;action=android.intent.action.VIEW;" +
            "category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encode(fallback)};end"
    }

    fun build(server: ServerAddress, roomId: String): String =
        "$SCHEME_PREFIX$HOST?$ROOM_QUERY=${encode(roomId)}&$SERVER_QUERY=${encode(server.displayUrl)}"

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private fun encodePathSegment(value: String): String = encode(value).replace("%2F", "%252F", ignoreCase = true)
}
