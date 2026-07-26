package io.github.yueby.musictogether.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test
    fun addsDefaultHttpSchemeAndBuildsEndpoints() {
        val address = ServerAddress.parse("192.168.1.8:3001")!!
        assertEquals("http://192.168.1.8:3001", address.displayUrl)
        assertEquals("ws://192.168.1.8:3001/ws", address.webSocketUrl.toString())
        assertEquals(
            "http://192.168.1.8:3001/api/music/search",
            address.api("music", "search").toString(),
        )
    }

    @Test
    fun keepsHttpsAndReverseProxyPath() {
        val address = ServerAddress.parse("https://example.com/music/")!!
        assertEquals("https://example.com/music", address.displayUrl)
        assertEquals("wss://example.com/music/ws", address.webSocketUrl.toString())
        assertEquals("https://example.com/music/api/health", address.api("health").toString())
    }

    @Test
    fun rejectsEmptyAddress() {
        assertNull(ServerAddress.parse("  "))
    }
}
