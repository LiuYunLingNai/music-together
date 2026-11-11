package io.github.yueby.musictogether.catalog

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.ArtistUiState
import io.github.yueby.musictogether.model.CatalogState
import io.github.yueby.musictogether.model.DiscoverUiState
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.network.MusicTogetherApi
import io.github.yueby.musictogether.network.ServerAddress
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal const val CatalogSource = "netease"
private const val PageSize = 50

internal class CatalogCoordinator(
    private val api: MusicTogetherApi,
    private val scope: CoroutineScope,
    private val activeServer: () -> ServerAddress?,
) {
    private val _state = MutableStateFlow(CatalogState())
    val state: StateFlow<CatalogState> = _state.asStateFlow()

    private var artistJob: Job? = null
    private var songsJob: Job? = null
    private var albumsJob: Job? = null
    private var discoverJob: Job? = null

    fun openArtist(source: String, id: String) {
        val server = activeServer() ?: return
        artistJob?.cancel()
        songsJob?.cancel()
        albumsJob?.cancel()
        _state.update { it.copy(artist = ArtistUiState(source = source, id = id)) }
        artistJob = scope.launch {
            runCatching { api.artistHome(server, source, id) }
                .onFailure {
                    if (it is CancellationException) throw it
                    AppLogger.warn("Catalog", "artist $source:$id failed: ${it.message}")
                    updateArtist(source, id) { state -> state.copy(loading = false, error = it.message ?: "歌手加载失败") }
                }
                .onSuccess { home ->
                    updateArtist(source, id) {
                        it.copy(
                            artist = home.artist,
                            songs = home.songs.items,
                            songsHasMore = home.songs.hasMore,
                            albums = home.albums.items,
                            albumsHasMore = home.albums.hasMore,
                            loading = false,
                            error = null,
                        )
                    }
                }
        }
    }

    fun loadMoreArtistSongs() {
        val server = activeServer() ?: return
        val current = _state.value.artist ?: return
        if (current.loading || current.loadingMoreSongs || !current.songsHasMore) return
        updateArtist(current.source, current.id) { it.copy(loadingMoreSongs = true) }
        songsJob = scope.launch {
            runCatching { api.artistSongs(server, current.source, current.id, current.songs.size, PageSize) }
                .onFailure {
                    if (it is CancellationException) throw it
                    updateArtist(current.source, current.id) { state -> state.copy(loadingMoreSongs = false) }
                }
                .onSuccess { page ->
                    updateArtist(current.source, current.id) {
                        it.copy(
                            songs = (it.songs + page.items).distinctBy { track -> track.id },
                            songsHasMore = page.hasMore,
                            loadingMoreSongs = false,
                        )
                    }
                }
        }
    }

    fun loadMoreArtistAlbums() {
        val server = activeServer() ?: return
        val current = _state.value.artist ?: return
        if (current.loading || current.loadingMoreAlbums || !current.albumsHasMore) return
        updateArtist(current.source, current.id) { it.copy(loadingMoreAlbums = true) }
        albumsJob = scope.launch {
            runCatching { api.artistAlbums(server, current.source, current.id, current.albums.size, PageSize) }
                .onFailure {
                    if (it is CancellationException) throw it
                    updateArtist(current.source, current.id) { state -> state.copy(loadingMoreAlbums = false) }
                }
                .onSuccess { page ->
                    updateArtist(current.source, current.id) {
                        it.copy(
                            albums = (it.albums + page.items).distinctBy { album: Playlist -> album.id },
                            albumsHasMore = page.hasMore,
                            loadingMoreAlbums = false,
                        )
                    }
                }
        }
    }

    fun closeArtist() {
        artistJob?.cancel()
        songsJob?.cancel()
        albumsJob?.cancel()
        _state.update { it.copy(artist = null) }
    }

    fun loadDiscover(force: Boolean = false) {
        val server = activeServer() ?: return
        val current = _state.value.discover
        if (current.loading || (!force && current.home != null)) return
        discoverJob?.cancel()
        _state.update { it.copy(discover = it.discover.copy(loading = true, error = null)) }
        discoverJob = scope.launch {
            runCatching { api.discoverHome(server, CatalogSource) }
                .onFailure {
                    if (it is CancellationException) throw it
                    AppLogger.warn("Catalog", "discover failed: ${it.message}")
                    _state.update { state ->
                        state.copy(discover = state.discover.copy(loading = false, error = it.message ?: "发现页加载失败"))
                    }
                }
                .onSuccess { home ->
                    _state.update { it.copy(discover = DiscoverUiState(home = home)) }
                }
        }
    }

    fun reset() {
        artistJob?.cancel()
        songsJob?.cancel()
        albumsJob?.cancel()
        discoverJob?.cancel()
        _state.value = CatalogState()
    }

    private fun updateArtist(source: String, id: String, transform: (ArtistUiState) -> ArtistUiState) {
        _state.update { state ->
            val artist = state.artist
            if (artist == null || artist.source != source || artist.id != id) state else state.copy(artist = transform(artist))
        }
    }
}
