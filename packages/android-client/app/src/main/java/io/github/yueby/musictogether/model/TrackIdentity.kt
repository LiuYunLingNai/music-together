package io.github.yueby.musictogether.model

/**
 * Stable identity shared by search, playlists, and the room queue. The server
 * generates a fresh [Track.id] whenever it returns a track, while sourceId
 * identifies the same song across those responses.
 */
fun Track.queueIdentity(): String = "$source:${sourceId.ifBlank { id }}"
