package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackRecoveryCoordinatorTest {
    @Test
    fun `healthy listeners ignore refresh broadcasts`() = scenario {
        assertFalse(recovery.onStreamRefreshed(track))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `network failure refreshes once then falls back if reload fails`() = scenario {
        assertTrue(recovery.onMediaFailure(track.id, false))
        assertTrue(recovery.onMediaFailure(track.id, false))
        assertEquals(listOf(Events.PLAYER_REFRESH_STREAM), sent.map { it.first })
        assertFalse(sent.single().second.optBoolean("degrade"))
        assertTrue(recovery.onStreamRefreshed(track.copy(streamUrl = "https://audio.test/new")))
        assertTrue(recovery.onMediaFailure(track.id, false))
        assertEquals(Events.PLAYER_REQUEST_SOURCE_FALLBACK, sent.last().first)
    }

    @Test
    fun `decode failure requests lower quality`() = scenario {
        recovery.onMediaFailure(track.id, true)
        assertTrue(sent.single().second.getBoolean("degrade"))
        assertEquals(track.id, sent.single().second.getString("trackId"))
    }

    @Test
    fun `ready prevents timeout and duplicate reload without resetting attempt budget`() = scenario {
        recovery.onMediaFailure(track.id, false)
        assertTrue(recovery.onStreamRefreshed(track))
        recovery.onReady(track.id)
        assertFalse(recovery.onStreamRefreshed(track))
        yield()
        assertTrue(failures.isEmpty())
        recovery.onMediaFailure(track.id, false)
        assertEquals(Events.PLAYER_REQUEST_SOURCE_FALLBACK, sent.last().first)
    }

    @Test
    fun `old server times out with bounded requests and never skips room`() = scenario {
        recovery.onMediaFailure(track.id, false)
        tick()
        assertEquals(listOf(8_000L, 15_000L), timeouts)
        tick()
        assertEquals(1, failures.size)
        recovery.onMediaFailure(track.id, false)
        assertEquals(2, sent.size)
        assertFalse(sent.any { it.first == Events.PLAYER_NEXT })
    }

    @Test
    fun `ordinary member cannot change room source or restart stopped room`() = scenario {
        current = current!!.copy(canControl = false)
        assertFalse(recovery.retry(false, roomStopped = true))
        assertFalse(recovery.requestFallback())
        recovery.onMediaFailure(track.id, false)
        tick()
        assertEquals(listOf(Events.PLAYER_REFRESH_STREAM), sent.map { it.first })
        assertEquals(1, failures.size)
    }

    @Test
    fun `pause and release cancel pending fallback`() = scenario {
        recovery.onMediaFailure(track.id, false)
        yield()
        recovery.cancelPending()
        yield()
        assertEquals(1, sent.size)
        assertFalse(recovery.onStreamRefreshed(track))
        recovery.reset()
        assertFalse(recovery.onStreamRefreshed(track))
        assertTrue(failures.isEmpty())
    }

    @Test
    fun `same track id in another server or room cannot receive old recovery`() = scenario {
        recovery.onMediaFailure(track.id, false)
        current = current!!.copy(key = current!!.key.copy(server = "https://other.test", roomId = "other"))
        assertFalse(recovery.onStreamRefreshed(track))
        tick()
        assertEquals(1, sent.size)
        assertTrue(failures.isEmpty())
    }

    @Test
    fun `disconnect cancels context and cannot report failure in next room`() = scenario {
        recovery.onMediaFailure(track.id, false)
        current = null
        tick()
        assertTrue(failures.isEmpty())
        assertFalse(recovery.onMediaFailure(track.id, false))
    }

    @Test
    fun `switched source keeps recovery bounded and rejects old source response`() = scenario {
        recovery.onMediaFailure(track.id, false)
        tick()
        val replacement = track.copy(source = "tencent", urlId = "qq-1")
        current = current!!.copy(track = replacement, key = current!!.key.copy(source = "tencent", urlId = "qq-1"))
        recovery.onSourceSwitched(current!!)
        assertFalse(recovery.onStreamRefreshed(track))
        recovery.onMediaFailure(track.id, true)
        assertEquals(1, failures.size)
        assertEquals(2, sent.size)
    }

    @Test
    fun `explicit retry targets parked track with optional downgrade`() = scenario {
        assertTrue(recovery.retry(true, roomStopped = true))
        assertFalse(recovery.retry(true, roomStopped = true))
        assertEquals(Events.PLAYER_RETRY_TRACK, sent.single().first)
        assertTrue(sent.single().second.getBoolean("degrade"))
        tick()
        assertEquals(1, failures.size)
    }

    @Test
    fun `failed send stops timers and reports connection error`() = scenario {
        sendOk = false
        assertFalse(recovery.onMediaFailure(track.id, false))
        yield()
        assertTrue(timeouts.isEmpty())
        assertEquals(1, failures.size)
    }

    private fun scenario(block: suspend Fixture.() -> Unit) = runBlocking {
        val fixture = Fixture(this)
        try {
            fixture.block()
        } finally {
            fixture.recovery.reset()
        }
    }

    private class Fixture(scope: CoroutineScope) {
        val track = Track("q1", "Song", listOf("Artist"), "Album", 180.0, "", "netease", "n1", "n1", streamUrl = "https://audio.test/song")
        var current: PlaybackRecoveryContext? = PlaybackRecoveryContext(
            PlaybackRecoveryKey("https://server.test", "room", track.id, track.source, track.urlId), track, true,
        )
        val sent = mutableListOf<Pair<String, JSONObject>>()
        val failures = mutableListOf<String>()
        val timeouts = mutableListOf<Long>()
        private val ticks = Channel<Unit>(Channel.UNLIMITED)
        var sendOk = true
        val recovery = PlaybackRecoveryCoordinator(
            scope, { current }, { event, data -> sent += event to data; sendOk },
            { failures += it }, { timeouts += it; ticks.receive() },
        )

        suspend fun tick() {
            yield()
            ticks.send(Unit)
            repeat(3) { yield() }
        }
    }
}
