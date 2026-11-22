package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.PlayState

internal enum class PlaybackRequestAction { Ignore, ResumeLocal, ToggleLocal, ControlRoom }

internal fun playbackRequestAction(
    playing: Boolean,
    local: PlayerUiState,
    roomPlaying: Boolean?,
    sleepHeld: Boolean,
): PlaybackRequestAction = when {
    local.resumingLocally -> PlaybackRequestAction.Ignore
    local.interruption != null || sleepHeld ->
        if (playing) PlaybackRequestAction.ResumeLocal else PlaybackRequestAction.Ignore
    local.localPlayback ->
        if (playing != local.playing) PlaybackRequestAction.ToggleLocal else PlaybackRequestAction.Ignore
    roomPlaying == null -> PlaybackRequestAction.Ignore
    playing && roomPlaying && !local.playing -> PlaybackRequestAction.ResumeLocal
    playing != roomPlaying -> PlaybackRequestAction.ControlRoom
    else -> PlaybackRequestAction.Ignore
}

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
