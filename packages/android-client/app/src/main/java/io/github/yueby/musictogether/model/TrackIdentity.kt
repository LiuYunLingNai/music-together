package io.github.yueby.musictogether.model

/**
 * Stable identity shared by search, playlists, and the room queue. The server
 * generates a fresh [Track.id] whenever it returns a track, while sourceId
 * identifies the same song across those responses.
 */
fun Track.queueIdentity(): String {
    // Bilibili's parts share a BV sourceId. Its urlId additionally includes
    // the selected CID, so it is the stable identity for a playable part.
    val identity = if (source == "bilibili" && urlId.isNotBlank()) urlId else sourceId.ifBlank { id }
    return "$source:$identity"
}
