package io.github.yueby.musictogether.library

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UserPlaylist
import io.github.yueby.musictogether.model.UserPlaylistAccess
import io.github.yueby.musictogether.model.UserPlaylistDetailState
import io.github.yueby.musictogether.model.UserPlaylistsState
import io.github.yueby.musictogether.network.ApiException
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

internal data class UserPlaylistOwner(val server: ServerAddress, val key: String, val hasPassword: Boolean)

internal class UserPlaylistCoordinator(
    private val api: MusicTogetherApi,
    private val scope: CoroutineScope,
    private val owner: () -> UserPlaylistOwner?,
    private val notify: (message: String, isError: Boolean) -> Unit,
) {
    private val _state = MutableStateFlow(UserPlaylistsState())
    val state: StateFlow<UserPlaylistsState> = _state.asStateFlow()

    private var listJob: Job? = null
    private var detailJob: Job? = null

    fun ensureLoaded(force: Boolean = false) {
        val current = owner() ?: return
        if (_state.value.ownerKey != current.key) {
            listJob?.cancel()
            detailJob?.cancel()
            _state.value = UserPlaylistsState(ownerKey = current.key)
        }
        if (!current.hasPassword) {
            _state.update { it.copy(access = UserPlaylistAccess.RequiresPassword, loaded = true, loading = false) }
            return
        }
        val snapshot = _state.value
        if (snapshot.loading || (!force && snapshot.loaded && snapshot.error == null)) return
        _state.update { it.copy(loading = true, error = null) }
        listJob = scope.launch {
            runCatching { api.userPlaylists(current.server) }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    if (!sameOwner(current)) return@onFailure
                    AppLogger.warn("UserPlaylist", "list failed: ${error.message}")
                    _state.update {
                        it.copy(
                            loading = false,
                            loaded = true,
                            access = if (error.isAccountRequired()) UserPlaylistAccess.RequiresPassword else it.access,
                            error = if (error.isAccountRequired()) null else error.message ?: "歌单加载失败",
                        )
                    }
                }
                .onSuccess { playlists ->
                    if (!sameOwner(current)) return@onSuccess
                    _state.update {
                        it.copy(
                            access = UserPlaylistAccess.Available,
                            playlists = playlists,
                            loading = false,
                            loaded = true,
                            error = null,
                        )
                    }
                }
        }
    }

    fun create(name: String, then: (UserPlaylist) -> Unit = {}) {
        val current = owner() ?: return
        mutate("新建歌单失败") {
            val created = api.createUserPlaylist(current.server, name.trim())
            _state.update { it.copy(playlists = listOf(created) + it.playlists.filterNot { p -> p.id == created.id }) }
            notify("已创建歌单「${created.name}」", false)
            then(created)
        }
    }

    fun rename(id: String, name: String) {
        val current = owner() ?: return
        mutate("重命名失败") {
            val renamed = api.renameUserPlaylist(current.server, id, name.trim())
            _state.update { state ->
                state.copy(
                    playlists = state.playlists.map { if (it.id == id) renamed else it },
                    detail = state.detail?.let { detail ->
                        if (detail.id != id) detail else detail.copy(detail = detail.detail?.copy(playlist = renamed))
                    },
                )
            }
        }
    }

    fun delete(id: String, onDeleted: () -> Unit = {}) {
        val current = owner() ?: return
        mutate("删除歌单失败") {
            api.deleteUserPlaylist(current.server, id)
            val removed = _state.value.playlists.firstOrNull { it.id == id }
            _state.update { state ->
                state.copy(
                    playlists = state.playlists.filterNot { it.id == id },
                    detail = state.detail?.takeIf { it.id != id },
                )
            }
            notify("已删除歌单「${removed?.name ?: ""}」", false)
            onDeleted()
        }
    }

    fun addTracks(id: String, tracks: List<Track>) {
        val current = owner() ?: return
        if (tracks.isEmpty()) return
        mutate("添加到歌单失败") {
            val added = api.addUserPlaylistTracks(current.server, id, tracks)
            val name = _state.value.playlists.firstOrNull { it.id == id }?.name.orEmpty()
            notify(if (added > 0) "已添加 $added 首到「$name」" else "歌曲已在「$name」中", false)
            refreshAfterChange(current, id)
        }
    }

    fun removeTrack(id: String, track: Track) {
        val current = owner() ?: return
        mutate("移出歌单失败") {
            api.removeUserPlaylistTrack(current.server, id, track.id)
            _state.update { state ->
                state.copy(
                    detail = state.detail?.let { detail ->
                        if (detail.id != id) {
                            detail
                        } else {
                            detail.copy(
                                detail = detail.detail?.let {
                                    it.copy(
                                        tracks = it.tracks.filterNot { item -> item.id == track.id },
                                        playlist = it.playlist.copy(trackCount = (it.playlist.trackCount - 1).coerceAtLeast(0)),
                                    )
                                },
                            )
                        }
                    },
                    playlists = state.playlists.map {
                        if (it.id == id) it.copy(trackCount = (it.trackCount - 1).coerceAtLeast(0)) else it
                    },
                )
            }
        }
    }

    fun openDetail(id: String) {
        val current = owner() ?: return
        detailJob?.cancel()
        _state.update { it.copy(detail = UserPlaylistDetailState(id = id)) }
        detailJob = scope.launch { loadDetail(current, id) }
    }

    fun closeDetail() {
        detailJob?.cancel()
        _state.update { it.copy(detail = null) }
    }

    fun reset() {
        listJob?.cancel()
        detailJob?.cancel()
        _state.value = UserPlaylistsState()
    }

    private suspend fun loadDetail(current: UserPlaylistOwner, id: String) {
        runCatching { api.userPlaylist(current.server, id) }
            .onFailure { error ->
                if (error is CancellationException) throw error
                if (!sameOwner(current)) return@onFailure
                _state.update { state ->
                    state.copy(
                        detail = state.detail?.takeIf { it.id == id }?.copy(loading = false, error = error.message ?: "歌单加载失败"),
                    )
                }
            }
            .onSuccess { detail ->
                if (!sameOwner(current)) return@onSuccess
                _state.update { state ->
                    state.copy(
                        detail = state.detail?.takeIf { it.id == id }?.copy(detail = detail, loading = false, error = null),
                        playlists = state.playlists.map { if (it.id == id) detail.playlist else it },
                    )
                }
            }
    }

    private suspend fun refreshAfterChange(current: UserPlaylistOwner, id: String) {
        runCatching { api.userPlaylists(current.server) }
            .onFailure { if (it is CancellationException) throw it }
            .onSuccess { playlists -> if (sameOwner(current)) _state.update { it.copy(playlists = playlists) } }
        if (_state.value.detail?.id == id) loadDetail(current, id)
    }

    private fun mutate(failure: String, block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true) }
        scope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                AppLogger.warn("UserPlaylist", "$failure: ${error.message}")
                notify(error.message ?: failure, true)
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    private fun sameOwner(current: UserPlaylistOwner): Boolean = _state.value.ownerKey == current.key

    private fun Throwable.isAccountRequired(): Boolean = this is ApiException && (statusCode == 401 || statusCode == 403)
}
