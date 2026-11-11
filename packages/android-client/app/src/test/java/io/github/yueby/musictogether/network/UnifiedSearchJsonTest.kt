package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UnifiedSearchJsonTest {
    @Test
    fun `keeps grouped platform candidates even when queue ids overlap`() {
        val page = parseUnifiedSearch(JSONObject("""{
          "groups":[{"key":"song","title":"Song Live","artist":["Artist"],"duration":120,"version":"live",
          "candidates":[{"id":"same","source":"netease","sourceId":"1","urlId":"1"},
          {"id":"same","source":"tencent","sourceId":"2","urlId":"2"}]}],"failedSources":["kugou"]
        }"""))
        assertEquals(2, page.tracks.size)
        assertEquals("live", page.groups.single().version)
        assertEquals(listOf("kugou"), page.failedSources)
        assertFalse(page.hasMore)
    }

    @Test
    fun `deduplicates source identities and ignores malformed candidate groups`() {
        val page = parseUnifiedSearch(JSONObject("""{"groups":[null,{},
          {"candidates":[{}, {"source":"future","sourceId":"1"}]},
          {"candidates":[{"id":"1","source":"netease","sourceId":"1"},
          {"id":"2","source":"netease","sourceId":"1"}]}]}"""))
        assertEquals(1, page.groups.size)
        assertEquals(1, page.tracks.size)
        assertTrue(parseUnifiedSearch(JSONObject()).groups.isEmpty())
    }
}
