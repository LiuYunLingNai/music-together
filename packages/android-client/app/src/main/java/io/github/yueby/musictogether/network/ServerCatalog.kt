package io.github.yueby.musictogether.network

import org.json.JSONArray

object ServerCatalog {
    private const val MAX_SERVERS = 10

    fun decode(raw: String?, fallback: String): List<String> {
        val values = runCatching {
            val array = JSONArray(raw ?: "[]")
            List(array.length()) { index -> array.optString(index) }
        }.getOrDefault(emptyList())
        return normalize(listOf(fallback) + values)
    }

    fun encode(urls: List<String>): String = JSONArray(normalize(urls)).toString()

    fun normalize(urls: List<String>): List<String> = urls
        .mapNotNull(ServerAddress::parse)
        .map(ServerAddress::displayUrl)
        .distinct()
        .take(MAX_SERVERS)
}
