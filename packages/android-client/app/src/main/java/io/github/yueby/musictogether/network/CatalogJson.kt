package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.Artist
import io.github.yueby.musictogether.model.ArtistHome
import io.github.yueby.musictogether.model.CatalogPage
import io.github.yueby.musictogether.model.DiscoverHome
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.Track
import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.optIntOrNull(name: String): Int? =
    if (has(name) && !isNull(name)) optInt(name) else null

internal fun JSONObject.toArtist(): Artist = Artist(
    id = optString("id"),
    name = optString("name", "未知歌手"),
    cover = optString("cover"),
    source = optString("source", "netease"),
    albumCount = optIntOrNull("albumCount"),
    songCount = optIntOrNull("songCount"),
    description = stringOrNull("description"),
)

private fun <T> JSONArray?.mapObjects(transform: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else List(length()) { transform(getJSONObject(it)) }

private fun <T> JSONObject?.toPage(transform: (JSONObject) -> T): CatalogPage<T> = CatalogPage(
    items = this?.optJSONArray("items").mapObjects(transform),
    hasMore = this?.optBoolean("hasMore", false) == true,
    total = this?.optIntOrNull("total"),
)

internal fun parseArtistHome(json: JSONObject): ArtistHome = ArtistHome(
    artist = requireNotNull(json.optJSONObject("artist")) { "缺少歌手资料" }.toArtist(),
    songs = json.optJSONObject("songs").toPage { it.toTrack() },
    albums = json.optJSONObject("albums").toPage { it.toPlaylist().copy(isAlbum = true) },
)

internal fun parseArtistSongs(json: JSONObject): CatalogPage<Track> = json.toPage { it.toTrack() }

internal fun parseArtistAlbums(json: JSONObject): CatalogPage<Playlist> =
    json.toPage { it.toPlaylist().copy(isAlbum = true) }

internal fun parseDiscoverHome(json: JSONObject): DiscoverHome = DiscoverHome(
    radar = json.optJSONArray("radar").mapObjects { it.toPlaylist() },
    artists = json.optJSONArray("artists").mapObjects { it.toArtist() },
    albums = json.optJSONArray("albums").mapObjects { it.toPlaylist().copy(isAlbum = true) },
    failed = json.optJSONArray("failed")?.let { array -> List(array.length()) { array.optString(it) }.toSet() }.orEmpty(),
)
