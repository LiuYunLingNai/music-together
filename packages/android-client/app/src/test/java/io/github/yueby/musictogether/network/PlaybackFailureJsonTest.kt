package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackFailureJsonTest {
    @Test
    fun `parses structured error and optional provider diagnostics`() {
        val event = requireNotNull(JSONObject("""{
          "trackId":"q1", "track":{"id":"q1","title":"Song","source":"netease"},
          "failure":{"source":"netease","reason":"rate-limited","retryable":true,
          "actionable":false,"httpStatus":429,"retryAfterMs":60000,"providerCode":"busy","providerMessage":"later"},
          "nextAction":"skip","autoActionInMs":8000
        }""").toPlaybackFailureEvent())
        assertEquals("q1", event.trackId)
        assertEquals("rate-limited", event.failure.reason)
        assertTrue(event.failure.retryable)
        assertFalse(event.failure.actionable)
        assertEquals(429, event.failure.httpStatus)
        assertEquals(60_000L, event.failure.retryAfterMs)
        assertEquals("busy", event.failure.providerCode)
        assertEquals("later", event.failure.providerMessage)
        assertEquals(8_000L, event.autoActionInMs)
    }

    @Test
    fun `missing optional fields and unknown actions safely fall back`() {
        val event = requireNotNull(JSONObject("""{
          "track":{"id":"q1"},"failure":{},"nextAction":"future-action"
        }""").toPlaybackFailureEvent())
        assertEquals("q1", event.trackId)
        assertEquals("stop", event.nextAction)
        assertEquals("unknown", event.failure.reason)
        assertFalse(event.failure.retryable)
        assertNull(event.failure.httpStatus)
        assertNull(event.autoActionInMs)
    }

    @Test
    fun `mismatched identities and incomplete events are rejected`() {
        assertNull(JSONObject("""{"trackId":"old","track":{"id":"new"},"failure":{}}""").toPlaybackFailureEvent())
        assertNull(JSONObject("""{"trackId":"q1","failure":{}}""").toPlaybackFailureEvent())
        assertNull(JSONObject("""{"track":{},"failure":{}}""").toPlaybackFailureEvent())
        assertNull(JSONObject("""{"track":{"id":"q1"}}""").toPlaybackFailureEvent())
    }
}
