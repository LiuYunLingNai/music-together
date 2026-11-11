package io.github.yueby.musictogether.catalog

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.Track
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

internal val HotSongsSources = listOf("netease", "tencent", "kugou")

data class HotSongsState(
    val roomId: String? = null,
    val source: String = "netease",
    val name: String = "热歌榜",
    val tracks: List<Track> = emptyList(),
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val hasMore: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
)

internal class HotSongsCoordinator(
    private val api: MusicTogetherApi,
    private val scope: CoroutineScope,
    private val context: () -> Pair<ServerAddress, String>?,
) {
    private val _state = MutableStateFlow(HotSongsState())
    val state: StateFlow<HotSongsState> = _state.asStateFlow()
    private var job: Job? = null

    fun load(source: String = _state.value.source, refresh: Boolean = false) {
        val (server, roomId) = context() ?: return
        val current = _state.value
        if (!refresh && current.roomId == roomId && current.source == source && current.loaded && current.error == null) return
        job?.cancel()
        _state.value = HotSongsState(roomId = roomId, source = source, loading = true)
        job = scope.launch {
            runCatching { api.hotSongs(server, roomId, source, offset = 0, refresh = refresh) }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    AppLogger.warn("HotSongs", "load $source failed: ${error.message}")
                    _state.update { if (it.source != source) it else it.copy(loading = false, loaded = true, error = error.message ?: "热歌榜加载失败") }
                }
                .onSuccess { page ->
                    _state.update {
                        if (it.source != source || it.roomId != roomId) {
                            it
                        } else {
                            it.copy(name = page.name, tracks = page.tracks, hasMore = page.hasMore, loading = false, loaded = true, error = null)
                        }
                    }
                }
        }
    }

    fun loadMore() {
        val (server, roomId) = context() ?: return
        val current = _state.value
        if (current.loading || current.loadingMore || !current.hasMore || current.roomId != roomId) return
        _state.update { it.copy(loadingMore = true, error = null) }
        val source = current.source
        job = scope.launch {
            runCatching { api.hotSongs(server, roomId, source, offset = current.tracks.size, refresh = false) }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    _state.update { if (it.source != source) it else it.copy(loadingMore = false, error = error.message ?: "加载失败") }
                }
                .onSuccess { page ->
                    _state.update {
                        if (it.source != source) {
                            it
                        } else {
                            it.copy(
                                tracks = (it.tracks + page.tracks).distinctBy { track -> "${track.source}:${track.sourceId}:${track.id}" },
                                hasMore = page.hasMore,
                                loadingMore = false,
                            )
                        }
                    }
                }
        }
    }

    fun reset() {
        job?.cancel()
        _state.update { HotSongsState(source = it.source) }
    }
}
