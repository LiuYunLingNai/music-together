package io.github.yueby.musictogether.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogJsonTest {
    @Test
    fun parsesArtistHomeWithAlbumsMarkedAsAlbum() {
        val home = parseArtistHome(
            JSONObject(
                """
                {
                  "artist": {"id": "6452", "name": "周杰伦", "cover": "c", "source": "netease", "songCount": 568, "description": "简介"},
                  "songs": {"items": [{"id": "s1", "title": "晴天", "artist": ["周杰伦"], "artistIds": ["6452"], "source": "netease"}], "hasMore": true, "total": 568},
                  "albums": {"items": [{"id": "a1", "name": "叶惠美", "trackCount": 11, "source": "netease"}], "hasMore": false}
                }
                """.trimIndent(),
            ),
        )

        assertEquals("周杰伦", home.artist.name)
        assertEquals(568, home.artist.songCount)
        assertNull(home.artist.albumCount)
        assertEquals(listOf("6452"), home.songs.items.single().artistIds)
        assertTrue(home.songs.hasMore)
        assertTrue(home.albums.items.single().isAlbum)
        assertFalse(home.albums.hasMore)
    }

    @Test
    fun parsesDiscoverHomeAndFailedBlocks() {
        val home = parseDiscoverHome(
            JSONObject(
                """
                {
                  "radar": [{"id": "1", "name": "私人雷达", "trackCount": 30, "source": "netease"}],
                  "artists": [{"id": "2", "name": "歌手", "cover": "c", "source": "netease"}],
                  "albums": [],
                  "failed": ["albums"]
                }
                """.trimIndent(),
            ),
        )

        assertEquals(1, home.radar.size)
        assertFalse(home.radar.single().isAlbum)
        assertEquals("歌手", home.artists.single().name)
        assertEquals(setOf("albums"), home.failed)
    }

    @Test
    fun trackWithoutArtistIdsKeepsEmptyList() {
        val track = JSONObject("""{"id": "s", "title": "t", "artist": ["a"], "source": "netease"}""").toTrack()

        assertTrue(track.artistIds.isEmpty())
    }
}
