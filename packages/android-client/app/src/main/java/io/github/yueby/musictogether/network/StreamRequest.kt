package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Track
import okhttp3.HttpUrl

internal fun streamRequestUrl(server: ServerAddress, track: Track, bitrate: String, roomId: String?, forceRefresh: Boolean = false): HttpUrl =
    server.api("music", "url").newBuilder()
        .addQueryParameter("source", track.source)
        .addQueryParameter("urlId", track.urlId)
        .addQueryParameter("bitrate", bitrate)
        .apply { roomId?.takeIf { it.isNotBlank() }?.let { addQueryParameter("roomId", it) } }
        .apply { if (forceRefresh) addQueryParameter("forceRefresh", "true") }
        .build()
