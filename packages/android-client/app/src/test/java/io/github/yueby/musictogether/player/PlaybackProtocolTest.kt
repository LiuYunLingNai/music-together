package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.network.toPlayState
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackProtocolTest {
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
