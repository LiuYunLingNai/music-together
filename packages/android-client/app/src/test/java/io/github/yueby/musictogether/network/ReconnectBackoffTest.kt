package io.github.yueby.musictogether.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReconnectBackoffTest {
    @Test
    fun defaultPolicyStopsAfterFiveIncreasingDelays() {
        val backoff = ReconnectBackoff()

        assertEquals(
            listOf(
                ReconnectAttempt(1, 2_000L),
                ReconnectAttempt(2, 4_000L),
                ReconnectAttempt(3, 8_000L),
                ReconnectAttempt(4, 15_000L),
                ReconnectAttempt(5, 30_000L),
            ),
            List(5) { backoff.nextAttempt() },
        )
        assertNull(backoff.nextAttempt())
    }

    @Test
    fun resetStartsAFullRetrySequenceAgain() {
        val backoff = ReconnectBackoff(listOf(10L, 20L))

        assertEquals(ReconnectAttempt(1, 10L), backoff.nextAttempt())
        backoff.reset()

        assertEquals(ReconnectAttempt(1, 10L), backoff.nextAttempt())
        assertEquals(ReconnectAttempt(2, 20L), backoff.nextAttempt())
        assertNull(backoff.nextAttempt())
    }
}
