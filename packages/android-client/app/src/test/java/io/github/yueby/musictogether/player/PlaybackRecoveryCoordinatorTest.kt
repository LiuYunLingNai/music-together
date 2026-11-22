package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackRecoveryCoordinatorTest {
    @Test
    fun `automatic recovery stays local even for owner and is bounded`() = scenario {
        assertTrue(recovery.onMediaFailure(track.id, false))
        assertTrue(recovery.onMediaFailure(track.id, false))
        settle()
        assertEquals(listOf(false), resolutions)
        assertEquals(1, reloaded.size)
        recovery.onMediaFailure(track.id, false)
        settle()
        assertEquals(listOf(false, true), resolutions)
        recovery.onMediaFailure(track.id, true)
        recovery.onMediaFailure(track.id, false)
        assertEquals(2, reloaded.size)
        assertEquals(1, failures.size)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `decode failure requests lower quality only on this device`() = scenario {
        recovery.onMediaFailure(track.id, true)
        settle()
        assertEquals(listOf(true), resolutions)
        assertEquals(track.id, reloaded.single().id)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `ready cancels timeout but preserves attempt budget`() = scenario {
        recovery.onMediaFailure(track.id, false)
        settle()
        recovery.onReady(track.id)
        tick()
        assertTrue(failures.isEmpty())
        recovery.onMediaFailure(track.id, false)
        settle()
        assertEquals(listOf(false, true), resolutions)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `load timeout ends local recovery without changing room`() = scenario {
        recovery.onMediaFailure(track.id, false)
        tick()
        assertEquals(listOf(15_000L), timeouts)
        assertEquals(1, failures.size)
        recovery.onMediaFailure(track.id, false)
        settle()
        assertEquals(1, resolutions.size)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `ordinary member can recover locally but cannot switch source or restart room`() = scenario {
        current = current!!.copy(canControl = false)
        assertFalse(recovery.retry(false, roomStopped = true))
        assertFalse(recovery.requestFallback())
        recovery.onMediaFailure(track.id, false)
        settle()
        assertEquals(1, reloaded.size)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `cancellation ignores an uncancellable late resolution`() = scenario {
        deferResolution = true
        recovery.onMediaFailure(track.id, false)
        settle()
        recovery.cancelPending()
        resolved.send(track)
        settle()
        assertTrue(reloaded.isEmpty())
        assertTrue(failures.isEmpty())
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `same queue id in another room rejects old resolution`() = scenario {
        deferResolution = true
        recovery.onMediaFailure(track.id, false)
        settle()
        current = current!!.copy(key = current!!.key.copy(server = "https://other.test", roomId = "other"))
        resolved.send(track)
        settle()
        assertTrue(reloaded.isEmpty())
        assertTrue(failures.isEmpty())
    }

    @Test
    fun `source identity change rejects former source response`() = scenario {
        deferResolution = true
        recovery.onMediaFailure(track.id, false)
        settle()
        current = current!!.copy(key = current!!.key.copy(source = "tencent", urlId = "qq-1"))
        resolved.send(track)
        settle()
        assertTrue(reloaded.isEmpty())
        assertTrue(failures.isEmpty())
    }

    @Test
    fun `disconnect suppresses old timeout and further recovery`() = scenario {
        recovery.onMediaFailure(track.id, false)
        settle()
        current = null
        tick()
        assertTrue(failures.isEmpty())
        assertFalse(recovery.onMediaFailure(track.id, false))
    }

    @Test
    fun `invalid local resolution cannot trigger fallback`() = scenario {
        deferResolution = true
        recovery.onMediaFailure(track.id, false)
        settle()
        resolved.send(track.copy(source = "tencent"))
        settle()
        assertEquals(1, failures.size)
        assertTrue(reloaded.isEmpty())
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `resolver exception reports only local failure`() = scenario {
        resolveFailure = true
        recovery.onMediaFailure(track.id, false)
        settle()
        assertEquals(1, failures.size)
        assertTrue(reloaded.isEmpty())
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `explicit fallback changes room and waits for source switch`() = scenario {
        assertTrue(recovery.requestFallback())
        assertFalse(recovery.requestFallback())
        assertEquals(Events.PLAYER_REQUEST_SOURCE_FALLBACK, sent.single().first)
        assertEquals(track.id, sent.single().second.getString("trackId"))
        val replacement = track.copy(source = "tencent", urlId = "qq-1")
        current = current!!.copy(track = replacement, key = current!!.key.copy(source = "tencent", urlId = "qq-1"))
        recovery.onSourceSwitched(current!!)
        recovery.onReady(track.id)
        tick()
        assertTrue(failures.isEmpty())
        assertTrue(resolutions.isEmpty())
    }

    @Test
    fun `explicit retry targets parked track with downgrade`() = scenario {
        assertTrue(recovery.retry(true, roomStopped = true))
        assertFalse(recovery.retry(true, roomStopped = true))
        assertEquals(Events.PLAYER_RETRY_TRACK, sent.single().first)
        assertTrue(sent.single().second.getBoolean("degrade"))
        tick()
        assertEquals(1, failures.size)
    }

    @Test
    fun `failed explicit send reports connection error without timeout`() = scenario {
        sendOk = false
        assertFalse(recovery.retry(false, roomStopped = true))
        settle()
        assertTrue(timeouts.isEmpty())
        assertEquals(1, failures.size)
    }

    private fun scenario(block: suspend Fixture.() -> Unit) = runBlocking {
        val fixture = Fixture(this)
        try {
            fixture.block()
        } finally {
            fixture.resolved.trySend(null)
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
        val resolutions = mutableListOf<Boolean>()
        val reloaded = mutableListOf<Track>()
        val timeouts = mutableListOf<Long>()
        val resolved = Channel<Track?>(Channel.UNLIMITED)
        private val ticks = Channel<Unit>(Channel.RENDEZVOUS)
        var sendOk = true
        var deferResolution = false
        var resolveFailure = false
        val recovery = PlaybackRecoveryCoordinator(
            scope, { current }, { event, data -> sent += event to data; sendOk },
            { failures += it },
            resolveLocal = { context, degrade ->
                resolutions += degrade
                if (resolveFailure) error("resolver unavailable")
                if (deferResolution) withContext(NonCancellable) { resolved.receive() }
                else context.track.copy(streamUrl = "https://audio.test/fresh")
            },
            reloadLocal = { reloaded += it; true },
            wait = { timeouts += it; ticks.receive() },
        )

        suspend fun settle() { repeat(5) { yield() } }
        suspend fun tick() {
            settle()
            ticks.trySend(Unit)
            settle()
        }
    }
}
