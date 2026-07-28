package io.github.yueby.musictogether.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class RoomJoinTarget(
    val roomId: String,
    val serverAddress: ServerAddress?,
)

object RoomJoinTargetParser {
    fun parse(value: String): RoomJoinTarget? {
        val input = value.trim()
        if (input.isEmpty()) return null

        if (!input.contains("://")) {
            return RoomJoinTarget(roomId = input, serverAddress = null)
        }

        val url = input.toHttpUrlOrNull() ?: return null
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
}
