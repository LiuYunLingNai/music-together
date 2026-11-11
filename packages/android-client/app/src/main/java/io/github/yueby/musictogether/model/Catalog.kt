package io.github.yueby.musictogether.model

import androidx.compose.runtime.Immutable

@Immutable
data class Artist(
    val id: String,
    val name: String,
    val cover: String,
    val source: String,
    val albumCount: Int? = null,
    val songCount: Int? = null,
    val description: String? = null,
)

@Immutable
data class CatalogPage<T>(
    val items: List<T>,
    val hasMore: Boolean,
    val total: Int? = null,
)

@Immutable
data class ArtistHome(
    val artist: Artist,
    val songs: CatalogPage<Track>,
    val albums: CatalogPage<Playlist>,
)

@Immutable
data class DiscoverHome(
    val radar: List<Playlist>,
    val artists: List<Artist>,
    val albums: List<Playlist>,
    val failed: Set<String>,
)

@Immutable
data class ArtistUiState(
    val source: String,
    val id: String,
    val artist: Artist? = null,
    val songs: List<Track> = emptyList(),
    val songsHasMore: Boolean = false,
    val albums: List<Playlist> = emptyList(),
    val albumsHasMore: Boolean = false,
    val loading: Boolean = true,
    val loadingMoreSongs: Boolean = false,
    val loadingMoreAlbums: Boolean = false,
    val error: String? = null,
)

@Immutable
data class DiscoverUiState(
    val home: DiscoverHome? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

@Immutable
data class CatalogState(
    val artist: ArtistUiState? = null,
    val discover: DiscoverUiState = DiscoverUiState(),
)
