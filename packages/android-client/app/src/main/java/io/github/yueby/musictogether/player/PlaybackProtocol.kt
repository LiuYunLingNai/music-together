package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.PlayState

/** Missing revisions are older compatible servers and must remain accepted. */
internal fun isStalePlaybackAction(incoming: PlayState, current: PlayState): Boolean =
    incoming.revision != null && incoming.revision < (current.revision ?: 0L)

internal fun canApplyPlaybackSync(
    hasTrackId: Boolean,
    responseTrackId: String?,
    currentTrackId: String?,
    playerTrackId: String?,
    responseTimestamp: Long,
    current: PlayState,
): Boolean = currentTrackId != null && playerTrackId == currentTrackId &&
    (!hasTrackId || responseTrackId == currentTrackId) && responseTimestamp >= current.serverTimestamp
