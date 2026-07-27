package io.github.yueby.musictogether.network

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerCatalogTest {
    @Test
    fun restoresSelectedServerFirstAndNormalizesDuplicates() {
        val raw = """["http://music.local:3001/","https://other.example.com","music.local:3001"]"""

        assertEquals(
            listOf("https://other.example.com", "http://music.local:3001"),
            ServerCatalog.decode(raw, "https://other.example.com/"),
        )
    }

    @Test
    fun malformedStoredValueFallsBackToCurrentServer() {
        assertEquals(
            listOf("http://192.168.1.9:3001"),
            ServerCatalog.decode("not-json", "192.168.1.9:3001"),
        )
    }

    @Test
    fun encodedCatalogRoundTrips() {
        val urls = listOf("https://one.example.com", "http://two.example.com:3001")

        assertEquals(urls, ServerCatalog.decode(ServerCatalog.encode(urls), urls.first()))
    }
}
