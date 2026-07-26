package io.github.yueby.musictogether.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class ServerAddress(val httpBase: HttpUrl) {
    val displayUrl: String = httpBase.toString().trimEnd('/')
    val webSocketUrl: String = httpBase.newBuilder()
        .addPathSegment("ws")
        .build()
        .toString()
        .replaceFirst(if (httpBase.isHttps) "https://" else "http://", if (httpBase.isHttps) "wss://" else "ws://")

    fun api(vararg segments: String): HttpUrl {
        val builder = httpBase.newBuilder().addPathSegment("api")
        segments.forEach(builder::addPathSegment)
        return builder.build()
    }

    companion object {
        fun parse(value: String): ServerAddress? {
            val trimmed = value.trim().trimEnd('/')
            if (trimmed.isBlank()) return null
            val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
            return withScheme.toHttpUrlOrNull()?.let(::ServerAddress)
        }
    }
}
