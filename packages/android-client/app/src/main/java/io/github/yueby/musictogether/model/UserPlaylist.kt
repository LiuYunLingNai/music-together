package io.github.yueby.musictogether.model

data class UserPlaylist(
    val id: String,
    val name: String,
    val cover: String?,
    val trackCount: Int,
    val createdAt: Long,
    val updatedAt: Long,
)

data class UserPlaylistDetail(
    val playlist: UserPlaylist,
    val tracks: List<Track>,
)

enum class UserPlaylistAccess {
    Unknown,
    Available,
    RequiresPassword,
}

data class UserPlaylistDetailState(
    val id: String,
    val detail: UserPlaylistDetail? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

data class UserPlaylistsState(
    val ownerKey: String? = null,
    val access: UserPlaylistAccess = UserPlaylistAccess.Unknown,
    val playlists: List<UserPlaylist> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val busy: Boolean = false,
    val detail: UserPlaylistDetailState? = null,
)
