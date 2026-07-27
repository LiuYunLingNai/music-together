package io.github.yueby.musictogether.model

data class User(
    val id: String,
    val nickname: String,
    val role: String,
    val avatarUrl: String? = null,
)

data class AccountProfile(
    val id: String,
    val nickname: String,
    val avatarUrl: String?,
    val hasPassword: Boolean,
    val role: String,
)

data class AdminUser(
    val id: String,
    val nickname: String,
    val avatarUrl: String?,
    val role: String,
    val hasPassword: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val lastSeenAt: Long,
)

data class AdminRoom(
    val id: String,
    val name: String,
    val creatorId: String,
    val userCount: Int,
    val hasPassword: Boolean,
    val currentTrackTitle: String?,
)

data class Track(
    val id: String,
    val title: String,
    val artist: List<String>,
    val album: String,
    val duration: Double,
    val cover: String,
    val source: String,
    val sourceId: String,
    val urlId: String,
    val lyricId: String? = null,
    val picId: String? = null,
    val streamUrl: String? = null,
    val vip: Boolean = false,
    val requestedBy: String? = null,
)

data class PlayState(
    val isPlaying: Boolean = false,
    val currentTime: Double = 0.0,
    val serverTimestamp: Long = 0L,
    val serverTimeToExecute: Long? = null,
)

data class RoomState(
    val id: String,
    val name: String,
    val creatorId: String,
    val hostId: String,
    val hasPassword: Boolean,
    val permanent: Boolean,
    val audioQuality: String,
    val users: List<User>,
    val queue: List<Track>,
    val currentTrack: Track?,
    val playState: PlayState,
    val playMode: String,
)

data class RoomListItem(
    val id: String,
    val name: String,
    val hasPassword: Boolean,
    val permanent: Boolean,
    val userCount: Int,
    val currentTrackTitle: String?,
    val currentTrackArtist: String?,
)

data class ChatMessage(
    val id: String,
    val userId: String,
    val nickname: String,
    val content: String,
    val timestamp: Long,
    val type: String,
)

data class VoteState(
    val id: String,
    val action: String,
    val initiatorId: String,
    val initiatorNickname: String,
    val votes: Map<String, Boolean>,
    val requiredVotes: Int,
    val totalUsers: Int,
    val expiresAt: Long,
    val payload: Map<String, String> = emptyMap(),
)

data class LyricWord(
    val text: String,
    val startTimeMs: Long,
    val endTimeMs: Long,
    val romanText: String = "",
)

data class LyricLine(
    val words: List<LyricWord>,
    val translatedLyric: String = "",
    val romanLyric: String = "",
    val startTimeMs: Long,
    val endTimeMs: Long,
    val isBackground: Boolean = false,
    val isDuet: Boolean = false,
    val isInterlude: Boolean = false,
) {
    val text: String get() = words.joinToString("") { it.text }
}

data class LyricsState(
    val trackId: String? = null,
    val lines: List<LyricLine> = emptyList(),
    val loading: Boolean = false,
    val source: String? = null,
    val error: String? = null,
)

data class PlatformAuthStatus(
    val platform: String,
    val loggedInCount: Int,
    val hasVip: Boolean,
    val maxVipType: Int,
)

data class MyPlatformAuth(
    val platform: String,
    val loggedIn: Boolean,
    val nickname: String? = null,
    val vipType: Int = 0,
)

data class Playlist(
    val id: String,
    val name: String,
    val cover: String,
    val trackCount: Int,
    val source: String,
    val creator: String? = null,
    val description: String? = null,
)

data class QrLoginState(
    val open: Boolean = false,
    val platform: String = "netease",
    val key: String? = null,
    val imageData: String? = null,
    val status: Int? = null,
    val message: String? = null,
    val loading: Boolean = false,
)

data class PlatformHubState(
    val authStatus: List<PlatformAuthStatus> = emptyList(),
    val myAuth: List<MyPlatformAuth> = emptyList(),
    val statusLoaded: Boolean = false,
    val qr: QrLoginState = QrLoginState(),
    val playlists: Map<String, List<Playlist>> = mapOf(
        "netease" to emptyList(),
        "tencent" to emptyList(),
        "kugou" to emptyList(),
    ),
    val playlistsLoading: Set<String> = emptySet(),
    val selectedPlaylist: Playlist? = null,
    val playlistTracks: List<Track> = emptyList(),
    val playlistTotal: Int = 0,
    val playlistHasMore: Boolean = false,
    val playlistLoading: Boolean = false,
    val playlistLoadingMore: Boolean = false,
    val playlistError: String? = null,
)

data class UiNotice(
    val id: Long = System.nanoTime(),
    val text: String,
    val isError: Boolean = false,
)

enum class ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
}

data class AppState(
    val serverUrl: String = "http://10.0.2.2:3001",
    val nickname: String = "",
    val connectionStatus: ConnectionStatus = ConnectionStatus.Disconnected,
    val rooms: List<RoomListItem> = emptyList(),
    val room: RoomState? = null,
    val userId: String? = null,
    val accountProfile: AccountProfile? = null,
    val accountLoading: Boolean = false,
    val accountBusy: Boolean = false,
    val adminUsers: List<AdminUser> = emptyList(),
    val adminRooms: List<AdminRoom> = emptyList(),
    val adminLoading: Boolean = false,
    val adminWorkingId: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val searchResults: List<Track> = emptyList(),
    val searchLoading: Boolean = false,
    val searchLoadingMore: Boolean = false,
    val searchHasSearched: Boolean = false,
    val searchHasMore: Boolean = false,
    val searchPage: Int = 0,
    val searchKeyword: String = "",
    val searchSource: String = "netease",
    val searchError: String? = null,
    val activeVote: VoteState? = null,
    val lyrics: LyricsState = LyricsState(),
    val platformHub: PlatformHubState = PlatformHubState(),
    val notice: UiNotice? = null,
    val error: String? = null,
)
