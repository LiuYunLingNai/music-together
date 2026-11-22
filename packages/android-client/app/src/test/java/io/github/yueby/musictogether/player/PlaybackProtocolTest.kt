package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.network.toPlayState
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackProtocolTest {
    @Test
    fun `explicit play while room plays restores this device without room control`() {
        val buffering = PlayerUiState(intendedPlaying = true)
        assertEquals(PlaybackRequestAction.ResumeLocal, playbackRequestAction(true, buffering, true, false))
        assertEquals(PlaybackRequestAction.ControlRoom, playbackRequestAction(false, buffering, true, false))
        assertEquals(PlaybackRequestAction.Ignore, playbackRequestAction(false, buffering, false, false))
    }

    @Test
    fun `held and recovering playback requests cannot pause the room`() {
        val held = PlayerUiState(interruption = LocalPlaybackInterruption.AudioRoute)
        assertEquals(PlaybackRequestAction.ResumeLocal, playbackRequestAction(true, held, true, false))
        assertEquals(PlaybackRequestAction.Ignore, playbackRequestAction(false, held, true, false))
        assertEquals(PlaybackRequestAction.Ignore,
            playbackRequestAction(true, held.copy(resumingLocally = true), true, false))
        assertEquals(PlaybackRequestAction.ResumeLocal, playbackRequestAction(true, PlayerUiState(), true, true))
    }

    @Test
    fun `offline file controls remain local and duplicate requests are ignored`() {
        val offline = PlayerUiState(localPlayback = true)
        assertEquals(PlaybackRequestAction.ToggleLocal, playbackRequestAction(true, offline, true, false))
        assertEquals(PlaybackRequestAction.Ignore, playbackRequestAction(false, offline, true, false))
        assertEquals(PlaybackRequestAction.Ignore, playbackRequestAction(true, PlayerUiState(), null, false))
    }

    @Test
    fun `local interruption requires the latest explicit resume snapshot`() {
        val gate = LocalPlaybackGate()
        gate.hold(LocalPlaybackInterruption.AudioRoute)
        gate.beginResume()
        val cancelled = requireNotNull(gate.resumeToken)
        gate.cancelResume()
        gate.beginResume()
        assertFalse(gate.completeResume(cancelled))
        assertTrue(gate.held)
        assertTrue(gate.completeResume(requireNotNull(gate.resumeToken)))
        assertFalse(gate.held)
        assertNull(gate.reason)
    }

    @Test
    fun `adding holds never releases an existing interruption`() {
        val gate = LocalPlaybackGate()
        assertTrue(gate.hold(LocalPlaybackInterruption.SleepTimer))
        assertFalse(gate.hold(LocalPlaybackInterruption.SleepTimer))
        gate.hold(LocalPlaybackInterruption.AudioFocus)
        gate.beginResume()
        gate.cancelResume()
        assertTrue(gate.held)
        assertEquals(LocalPlaybackInterruption.SleepTimer, gate.reason)
        gate.release()
        assertFalse(gate.held)
    }

    @Test
    fun `local rejoin projects position at readiness without tempo correction`() {
        val playing = PlayState(isPlaying = true, currentTime = 60.25, serverTimestamp = 1_000)
        assertEquals(64_750L, roomPlaybackPositionMs(playing, 5_500))
        assertEquals(60_250L, roomPlaybackPositionMs(playing.copy(isPlaying = false), 5_500))
        assertEquals(60_250L, roomPlaybackPositionMs(playing, 900))
        assertEquals(60_250L, roomPlaybackPositionMs(playing.copy(serverTimestamp = 0), 5_500))
    }

    @Test
    fun `controls show room intention while buffering and local restore when held`() {
        val buffering = PlayerUiState(playing = false, intendedPlaying = true)
        assertTrue(buffering.controlPlaying)
        assertFalse(buffering.copy(interruption = LocalPlaybackInterruption.AudioRoute).controlPlaying)
        assertFalse(buffering.copy(resumingLocally = true).controlPlaying)
        assertFalse(buffering.copy(localPlayback = true).controlPlaying)
    }

    @Test
    fun `rejects older actions but accepts legacy missing revision`() {
        val current = PlayState(revision = 12)
        assertTrue(isStalePlaybackAction(PlayState(revision = 11), current))
        assertFalse(isStalePlaybackAction(PlayState(revision = 12), current))
        assertFalse(isStalePlaybackAction(PlayState(revision = 13), current))
        assertFalse(isStalePlaybackAction(PlayState(), current))
        assertFalse(isStalePlaybackAction(current, PlayState()))
    }

    @Test
    fun `invalid optional revision falls back instead of rejecting legacy packets`() {
        assertEquals(12L, JSONObject("""{"revision":12}""").toPlayState().revision)
        listOf("null", "-1", "2.5", "\"12\"").forEach {
            assertNull(JSONObject("{\"revision\":$it}").toPlayState().revision)
        }
    }

    @Test
    fun `sync checks track and action time including legacy packets`() {
        val current = PlayState(serverTimestamp = 1000)
        assertTrue(canApplyPlaybackSync(true, "new", "new", "new", 1100, current))
        assertFalse(canApplyPlaybackSync(true, "old", "new", "new", 1100, current))
        assertFalse(canApplyPlaybackSync(true, null, "new", "new", 1100, current))
        assertFalse(canApplyPlaybackSync(false, null, "new", "old", 1100, current))
        assertFalse(canApplyPlaybackSync(false, null, "new", "new", 900, current))
        assertTrue(canApplyPlaybackSync(false, null, "new", "new", 1100, current))
    }
}
