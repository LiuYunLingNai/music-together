package io.github.yueby.musictogether.account

import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.PlatformHubState
import io.github.yueby.musictogether.network.Events
import io.github.yueby.musictogether.network.toMyPlatformAuth
import io.github.yueby.musictogether.network.toRoomState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlatformPreferenceCoordinatorTest {
    @Test
    fun `values change only after matching positive acknowledgment`() = scenario {
        coordinator.set("netease", false, false)
        coordinator.set("netease", false, false)
        assertEquals(1, sent.size)
        assertEquals(true, state.platformHub.myAuth.single().shareWithRoom)
        assertEquals(setOf("netease:shareWithRoom"), state.platformHub.pendingPreferences)
        coordinator.onResult(false, JSONObject("""{"platform":"netease","shareWithRoom":false,"ok":true}"""))
        assertEquals(false, state.platformHub.myAuth.single().shareWithRoom)
        assertEquals(Events.AUTH_GET_STATUS, sent.last())
        assertTrue(state.platformHub.pendingPreferences.isEmpty())
    }

    @Test
    fun `negative acknowledgment retains account and preference`() = scenario {
        coordinator.set("netease", true, true)
        coordinator.onResult(true, JSONObject("""{"platform":"netease","reportListening":false,"ok":false}"""))
        assertEquals(false, state.platformHub.myAuth.single().reportListening)
        assertTrue(state.platformHub.myAuth.single().loggedIn)
        assertEquals(1, notices.size)
    }

    @Test
    fun `legacy fields disable writes and reporting defaults remain off`() = scenario {
        val legacy = JSONObject("""{"platform":"netease","loggedIn":true}""").toMyPlatformAuth()
        assertNull(legacy.shareWithRoom)
        assertNull(legacy.reportListening)
        state = state.copy(platformHub = PlatformHubState(myAuth = listOf(legacy)))
        coordinator.set("netease", false, false)
        coordinator.set("netease", true, true)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `late reply after server or room change is ignored`() = scenario {
        coordinator.set("netease", false, false)
        state = state.copy(selectedServerUrl = "https://new.test")
        coordinator.onResult(false, JSONObject("""{"platform":"netease","shareWithRoom":false,"ok":true}"""))
        assertEquals(true, state.platformHub.myAuth.single().shareWithRoom)
    }

    @Test
    fun `timeout releases switch without optimistic success`() = scenario {
        coordinator.set("netease", true, true)
        yield()
        ticks.send(Unit)
        yield()
        assertTrue(state.platformHub.pendingPreferences.isEmpty())
        assertEquals(false, state.platformHub.myAuth.single().reportListening)
        assertEquals(1, notices.size)
    }

    @Test
    fun `logout cancels pending preference without touching unrelated credentials`() = scenario {
        coordinator.set("netease", false, false)
        coordinator.cancel("netease")
        coordinator.onResult(false, JSONObject("""{"platform":"netease","shareWithRoom":false,"ok":true}"""))
        assertTrue(state.platformHub.pendingPreferences.isEmpty())
        assertEquals(true, state.platformHub.myAuth.single().shareWithRoom)
        assertTrue(notices.isEmpty())
    }

    private fun scenario(block: suspend Fixture.() -> Unit) = runBlocking {
        val fixture = Fixture(this)
        try { fixture.block() } finally { fixture.coordinator.cancel() }
    }

    private class Fixture(scope: CoroutineScope) {
        var state = AppState(
            userId = "me", selectedServerUrl = "https://server.test",
            room = JSONObject("""{"id":"room"}""").toRoomState(),
            platformHub = PlatformHubState(myAuth = listOf(JSONObject("""{
              "platform":"netease","loggedIn":true,"shareWithRoom":true,"reportListening":false
            }""").toMyPlatformAuth())),
        )
        val sent = mutableListOf<String>()
        val notices = mutableListOf<String>()
        val ticks = Channel<Unit>(Channel.UNLIMITED)
        val coordinator = PlatformPreferenceCoordinator(
            scope, { state }, { state = it(state) }, { event, _ -> sent += event; true },
            { notices += it }, { ticks.receive() },
        )
    }
}
