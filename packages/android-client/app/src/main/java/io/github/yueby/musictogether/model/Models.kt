package io.github.yueby.musictogether.model

import androidx.compose.runtime.Immutable

@Immutable
data class User(
    val id: String,
    val nickname: String,
    val role: String,
    val avatarUrl: String? = null,
    val isServerAdmin: Boolean = false,
)

@Immutable
data class RoomMember(
    val id: String,
    val nickname: String,
    val role: String,
    val avatarUrl: String? = null,
    val isServerAdmin: Boolean = false,
    val isOnline: Boolean,
    val joinedAt: Long,
    val lastSeenAt: Long? = null,
)

@Immutable
data class AccountProfile(
    val id: String,
    val nickname: String,
    val avatarUrl: String?,
    val hasPassword: Boolean,
    val role: String,
)

@Immutable
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

@Immutable
data class AdminRoom(
    val id: String,
    val name: String,
    val creatorId: String,
    val userCount: Int,
    val hasPassword: Boolean,
    val hidden: Boolean = false,
    val permanent: Boolean = false,
    val currentTrackTitle: String?,
)

@Immutable
data class AudioProxyPolicy(
    val kugouForceProxy: Boolean = true,
)

@Immutable
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
    val bilibiliCover: String? = null,
    val metadataSource: String? = null,
    val streamUrl: String? = null,
    val requiresServerProxy: Boolean = false,
    val streamFormat: String? = null,
    val vip: Boolean = false,
    val requestedBy: String? = null,
)

@Immutable
data class BilibiliMetadataMatchState(
    val track: Track? = null,
    val pinned: Boolean = false,
    val queueTrackId: String? = null,
    val source: String = "netease",
    val keyword: String = "",
    val results: List<Track> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@Immutable
data class BilibiliCollectionState(
    val track: Track? = null,
    val pinned: Boolean = false,
    val queueTrackId: String? = null,
    val title: String = "",
    val tracks: List<Track> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@Immutable
data class PlayState(
    val isPlaying: Boolean = false,
    val currentTime: Double = 0.0,
    val serverTimestamp: Long = 0L,
    val serverTimeToExecute: Long? = null,
)

@Immutable
data class RoomState(
    val id: String,
    val name: String,
    val creatorId: String,
    val hostId: String,
    val temporaryAdminUserId: String? = null,
    val hasPassword: Boolean,
    val hidden: Boolean = false,
    val permanent: Boolean,
    val allowTemporaryAdminTrackRemoval: Boolean = false,
    val allowTemporaryAdminQueueClear: Boolean = false,
    val audioQuality: String,
    val users: List<User>,
    val members: List<RoomMember> = emptyList(),
    val queue: List<Track>,
    val currentTrack: Track?,
    val playState: PlayState,
    val playMode: String,
)

@Immutable
data class RoomListItem(
    val id: String,
    val name: String,
    val hasPassword: Boolean,
    val permanent: Boolean,
    val userCount: Int,
    val currentTrackTitle: String?,
    val currentTrackArtist: String?,
)

@Immutable
data class ServerConnection(
    val url: String,
    val status: ConnectionStatus = ConnectionStatus.Disconnected,
    val rooms: List<RoomListItem> = emptyList(),
    val error: String? = null,
)

@Immutable
data class ChatMessage(
    val id: String,
    val userId: String,
    val nickname: String,
    val content: String,
    val timestamp: Long,
    val type: String,
)

@Immutable
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

@Immutable
data class LyricRuby(
    val text: String,
    val startTimeMs: Long,
    val endTimeMs: Long,
)

@Immutable
data class LyricWord(
    val text: String,
    val startTimeMs: Long,
    val endTimeMs: Long,
    val romanText: String = "",
    val ruby: List<LyricRuby> = emptyList(),
)

@Immutable
data class LyricLine(
    val words: List<LyricWord>,
    val translatedLyric: String = "",
    val romanLyric: String = "",
    val startTimeMs: Long,
    val endTimeMs: Long,
    val isBackground: Boolean = false,
    val isDuet: Boolean = false,
) {
    val text: String get() = words.joinToString("") { it.text }
}

@Immutable
data class LyricsState(
    val trackId: String? = null,
    val lines: List<LyricLine> = emptyList(),
    val loading: Boolean = false,
    val source: String? = null,
    val error: String? = null,
)

@Immutable
data class PlatformAuthStatus(
    val platform: String,
    val loggedInCount: Int,
    val hasVip: Boolean,
    val maxVipType: Int,
    val maxVipLabel: String? = null,
    val maxVipLevel: Int? = null,
)

@Immutable
data class MyPlatformAuth(
    val platform: String,
    val loggedIn: Boolean,
    val nickname: String? = null,
    val vipType: Int = 0,
    val vipLabel: String? = null,
    val vipLevel: Int? = null,
)

@Immutable
data class Playlist(
    val id: String,
    val name: String,
    val cover: String,
    val trackCount: Int,
    val source: String,
    val creator: String? = null,
    val description: String? = null,
)

@Immutable
data class PlatformRecommendation(
    val platform: String,
    val tracks: List<Track>,
    val unavailableReason: String? = null,
)

@Immutable
data class QrLoginState(
    val open: Boolean = false,
    val platform: String = "netease",
    val key: String? = null,
    val imageData: String? = null,
    val status: Int? = null,
    val message: String? = null,
    val loading: Boolean = false,
)

@Immutable
data class PlatformHubState(
    val authStatus: List<PlatformAuthStatus> = emptyList(),
    val myAuth: List<MyPlatformAuth> = emptyList(),
    val statusLoaded: Boolean = false,
    val qr: QrLoginState = QrLoginState(),
    val playlists: Map<String, List<Playlist>> = mapOf(
        "netease" to emptyList(),
        "tencent" to emptyList(),
        "kugou" to emptyList(),
        "kugou_concept" to emptyList(),
        "bilibili" to emptyList(),
    ),
    val playlistsLoading: Set<String> = emptySet(),
    val selectedPlaylist: Playlist? = null,
    val playlistTracks: List<Track> = emptyList(),
    val playlistTotal: Int = 0,
    val playlistHasMore: Boolean = false,
    val playlistLoading: Boolean = false,
    val playlistLoadingMore: Boolean = false,
    val playlistError: String? = null,
    val claimingKugouConceptVip: Boolean = false,
)

@Immutable
data class UiNotice(
    val id: Long = System.nanoTime(),
    val text: String,
    val isError: Boolean = false,
)

@Immutable
enum class ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
}

@Immutable
data class AppState(
    val serverUrl: String = "http://10.0.2.2:3001",
    val selectedServerUrl: String = serverUrl,
    val servers: List<ServerConnection> = emptyList(),
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
    val audioProxyPolicy: AudioProxyPolicy = AudioProxyPolicy(),
    val adminLoading: Boolean = false,
    val adminWorkingId: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val chatUnreadCount: Int = 0,
    val searchResults: List<Track> = emptyList(),
    val searchLoading: Boolean = false,
    val searchLoadingMore: Boolean = false,
    val searchHasSearched: Boolean = false,
    val searchHasMore: Boolean = false,
    val searchPage: Int = 0,
    val searchKeyword: String = "",
    val searchSource: String = "netease",
    val searchError: String? = null,
    val recommendations: List<PlatformRecommendation> = emptyList(),
    val recommendationsLoading: Boolean = false,
    val recommendationsLoaded: Boolean = false,
    val recommendationsError: String? = null,
    val bilibiliMetadataMatch: BilibiliMetadataMatchState = BilibiliMetadataMatchState(),
    val bilibiliCollection: BilibiliCollectionState = BilibiliCollectionState(),
    val lyricOffsets: Map<String, Int> = emptyMap(),
    val activeVote: VoteState? = null,
    val lyrics: LyricsState = LyricsState(),
    val platformHub: PlatformHubState = PlatformHubState(),
    val playbackTempoSyncEnabled: Boolean = false,
    val playbackHardSeekSyncEnabled: Boolean = false,
    val syncPacketIntervalSeconds: Int = 3,
    val syncDriftSeconds: Double = 0.0,
    val pingMs: Long? = null,
    val updateSource: UpdateDownloadSource = UpdateDownloadSource.GitHub,
    val updateInfo: AppUpdateInfo? = null,
    val updateChecking: Boolean = false,
    val updateDownloading: Boolean = false,
    val updateDownloadProgress: Int? = null,
    val updateReadyToInstall: Boolean = false,
    val updateError: String? = null,
    val notice: UiNotice? = null,
    val error: String? = null,
)

@Immutable
data class AppUpdateInfo(
    val versionName: String,
    val releaseNotes: String,
    val apkUrl: String,
    val checksumUrl: String,
)

enum class UpdateDownloadSource {
    GitHub,
    Ghfast,
}
