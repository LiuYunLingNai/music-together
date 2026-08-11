package io.github.yueby.musictogether

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.yueby.musictogether.account.AccountCoordinator
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.lyrics.LyricsParser
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.AudioProxyPolicy
import io.github.yueby.musictogether.model.BilibiliMetadataMatchState
import io.github.yueby.musictogether.model.BilibiliCollectionState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.OfflineDownloadState
import io.github.yueby.musictogether.model.OfflineLibraryState
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.MusicDownloadState
import io.github.yueby.musictogether.model.nextChatUnreadCount
import io.github.yueby.musictogether.model.PlatformHubState
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.QrLoginState
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.RoomMember
import io.github.yueby.musictogether.model.ServerConnection
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiNotice
import io.github.yueby.musictogether.model.UpdateDownloadSource
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.model.offlineDownloadKey
import io.github.yueby.musictogether.network.AppUpdateService
import io.github.yueby.musictogether.network.ApiException
import io.github.yueby.musictogether.network.DownloadSpeedTracker
import io.github.yueby.musictogether.network.DiscoveryConnectionCoordinator
import io.github.yueby.musictogether.network.Events
import io.github.yueby.musictogether.network.MusicDownloadService
import io.github.yueby.musictogether.network.MusicDownloadStorage
import io.github.yueby.musictogether.network.MusicTogetherApi
import io.github.yueby.musictogether.network.MusicTogetherSocket
import io.github.yueby.musictogether.network.PersistentCookieJar
import io.github.yueby.musictogether.network.PlaybackTarget
import io.github.yueby.musictogether.network.ReconnectBackoff
import io.github.yueby.musictogether.network.RoomJoinTargetParser
import io.github.yueby.musictogether.network.ServerAddress
import io.github.yueby.musictogether.network.ServerCatalog
import io.github.yueby.musictogether.network.SocketEvents
import io.github.yueby.musictogether.network.normalizeSearchKeyword
import io.github.yueby.musictogether.network.stringOrNull
import io.github.yueby.musictogether.network.audioQuality
import io.github.yueby.musictogether.network.mergeTencentRecommendationPages
import io.github.yueby.musictogether.network.musicMimeType
import io.github.yueby.musictogether.network.resolveMusicDownloadDirectory
import io.github.yueby.musictogether.network.shouldRemoveStoredPlatformCredential
import io.github.yueby.musictogether.network.suggestedMusicFileName
import io.github.yueby.musictogether.network.toChatMessage
import io.github.yueby.musictogether.network.toPlayState
import io.github.yueby.musictogether.network.toPlaylist
import io.github.yueby.musictogether.network.toPlatformAuthStatus
import io.github.yueby.musictogether.network.toMyPlatformAuth
import io.github.yueby.musictogether.network.toRoomList
import io.github.yueby.musictogether.network.toRoomState
import io.github.yueby.musictogether.network.toTrack
import io.github.yueby.musictogether.network.toUser
import io.github.yueby.musictogether.network.toVoteState
import io.github.yueby.musictogether.network.toJson
import io.github.yueby.musictogether.notifications.ChatNotificationManager
import io.github.yueby.musictogether.offline.OfflineLibrary
import io.github.yueby.musictogether.notifications.MusicDownloadNotificationManager
import io.github.yueby.musictogether.player.ClockSync
import io.github.yueby.musictogether.player.NativePlayer
import io.github.yueby.musictogether.player.PlaybackCommandBridge
import io.github.yueby.musictogether.player.PlayerUiState
import io.github.yueby.musictogether.queue.QueueActionTracker
import io.github.yueby.musictogether.queue.loadCompletePlaylist
import io.github.yueby.musictogether.queue.planPlaylistQueueBatches
import io.github.yueby.musictogether.settings.AppPreferences
import io.github.yueby.musictogether.updates.AppUpdateCoordinator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class MusicTogetherViewModel(application: Application) : AndroidViewModel(application), SocketEvents {
    private data class PendingRoomCreation(val name: String, val password: String)
    private data class PlaylistContext(val source: String, val id: String, val roomId: String)

    private companion object {
        const val QR_EXPIRED = 800
        const val QR_WAITING_SCAN = 801
        const val QR_SUCCESS = 803
        const val MAX_QUEUE_SIZE = 1000
        const val MAX_QUEUE_BATCH_SIZE = 200
        val BILIBILI_METADATA_SOURCES = setOf("netease", "tencent", "kugou", "kugou_concept")
        const val DEFAULT_SERVER_URL = "https://sharemusic.lyln114514.com"
        const val MAX_SERVERS = 10
        const val DEFAULT_SYNC_PACKET_INTERVAL_SECONDS = 3
        const val MIN_SYNC_PACKET_INTERVAL_SECONDS = 1
        const val MAX_SYNC_PACKET_INTERVAL_SECONDS = 60
        const val GITHUB_RELEASES_API = "https://api.github.com/repos/LiuYunLingNai/music-together/releases"
    }

    private val appPreferences = AppPreferences(application)
    private val playbackSyncSettings = appPreferences.loadPlaybackSyncSettings()
    private val initialServerUrls = appPreferences.initialServerUrls(DEFAULT_SERVER_URL)
    private val okHttp = OkHttpClient.Builder()
        .cookieJar(PersistentCookieJar(application))
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val api = MusicTogetherApi(okHttp)
    private val offlineLibrary = OfflineLibrary(application, okHttp)
    private val initialMusicDownloadDirectory = appPreferences.musicDownloadDirectory()
    private val initialOfflineTracks = offlineLibrary.tracks()
    private val musicDownloads = MusicDownloadService(okHttp)
    private val musicDownloadStorage = MusicDownloadStorage(application)
    private val socket = MusicTogetherSocket(okHttp, this)
    private val chatNotifications = ChatNotificationManager(application)
    private val musicDownloadNotifications = MusicDownloadNotificationManager(application)
    private val clock = ClockSync()
    private val _state = MutableStateFlow(
        AppState(
            serverUrl = initialServerUrls.first(),
            selectedServerUrl = initialServerUrls.first(),
            servers = initialServerUrls.map { ServerConnection(it) },
            nickname = appPreferences.nickname(),
            lyricOffsets = appPreferences.loadLyricOffsets(),
            playbackTempoSyncEnabled = playbackSyncSettings.tempoEnabled,
            playbackHardSeekSyncEnabled = playbackSyncSettings.hardSeekEnabled,
            syncPacketIntervalSeconds = appPreferences.syncPacketInterval(
                defaultValue = DEFAULT_SYNC_PACKET_INTERVAL_SECONDS,
                range = MIN_SYNC_PACKET_INTERVAL_SECONDS..MAX_SYNC_PACKET_INTERVAL_SECONDS,
            ),
            updateSource = appPreferences.updateSource(),
            offlineLibrary = OfflineLibraryState(tracks = initialOfflineTracks),
            musicDownloadDirectory = initialMusicDownloadDirectory,
        ),
    )
    val state: StateFlow<AppState> = _state.asStateFlow()
    private val appUpdates = AppUpdateCoordinator(
        application = application,
        service = AppUpdateService(okHttp),
        scope = viewModelScope,
        state = { _state.value },
        updateState = { transform -> _state.value = transform(_state.value) },
        showNotice = ::showNotice,
    )
    private val nativePlayer = NativePlayer(
        application,
        viewModelScope,
        clock,
        _state.value.playbackTempoSyncEnabled,
        _state.value.playbackHardSeekSyncEnabled,
        ::onTrackEnded,
    )
    private val accounts = AccountCoordinator(
        application = application,
        api = api,
        preferences = appPreferences,
        scope = viewModelScope,
        state = { _state.value },
        updateState = { transform -> _state.value = transform(_state.value) },
        activeServer = { activeServer },
        desiredRoomId = { desiredRoomId },
        clearIdentityBoundState = ::clearIdentityBoundClientState,
        reconnect = ::reconnectSocket,
        prepareLogout = {
            desiredRoomId = null
            desiredRoomPassword = null
            nativePlayer.stop()
        },
        applyAudioProxyPolicy = ::applyAudioProxyPolicy,
        showNotice = ::showNotice,
        setError = ::setError,
    )
    val playerState: StateFlow<PlayerUiState> = nativePlayer.state

    private var activeServer: ServerAddress? = null
    private val offlineDownloadJobs = mutableMapOf<String, Job>()
    private val discovery = DiscoveryConnectionCoordinator(
        okHttp = okHttp,
        api = api,
        scope = viewModelScope,
        activeServer = { activeServer },
        servers = { _state.value.servers },
        updateServer = ::updateServerConnection,
    )
    private var socketServerUrl: String? = null
    private var desiredRoomId: String? = null
    private var desiredRoomPassword: String? = null
    private var pendingRoomCreation: PendingRoomCreation? = null
    private var shouldReconnect = false
    private var reconnectJob: Job? = null
    private val reconnectBackoff = ReconnectBackoff()
    private var clockJob: Job? = null
    private var bilibiliMetadataSearchJob: Job? = null
    private var bilibiliCollectionJob: Job? = null
    private var syncJob: Job? = null
    private var lyricJob: Job? = null
    private var searchJob: Job? = null
    private var recommendationsJob: Job? = null
    private var downloadOptionsJob: Job? = null
    private var musicDownloadJob: Job? = null
    private var qrPollJob: Job? = null
    private var qrCloseJob: Job? = null
    private var playlistJob: Job? = null
    private var playlistAddAllJob: Job? = null
    private var playlistContext: PlaylistContext? = null
    private var restoredAuthRoomId: String? = null
    private var appInForeground = false
    private var chatVisible = false
    private var lastRtt: Long? = null
    private var waitingForJoinRoomState = false
    private var recoveredTrackId: String? = null
    private val queueActions = QueueActionTracker()
    private val autoRestoringPlatforms = mutableSetOf<String>()
    private val loadedPlaylistPlatforms = mutableSetOf<String>()
    private val supportedPlatforms = listOf("netease", "tencent", "kugou", "kugou_concept", "bilibili")

    init {
        PlaybackCommandBridge.listener = object : PlaybackCommandBridge.Listener {
            override fun onTogglePlayback() = this@MusicTogetherViewModel.togglePlayback()
            override fun onNext() = this@MusicTogetherViewModel.next()
            override fun onPrevious() = this@MusicTogetherViewModel.previous()
        }
        viewModelScope.launch {
            val tracks = withContext(Dispatchers.IO) {
                offlineLibrary.importPublicDownloads(initialMusicDownloadDirectory)
            }
            updateOfflineLibrary { it.copy(tracks = tracks) }
        }
        checkForAppUpdate(silent = true)
        if (_state.value.serverUrl.isNotBlank()) connect()
    }

    fun updateServerUrl(value: String) {
        _state.value = _state.value.copy(serverUrl = value)
    }

    fun updateNickname(value: String) {
        val safe = value.take(40)
        appPreferences.setNickname(safe)
        _state.value = _state.value.copy(nickname = safe)
    }

    fun refreshAccount(showError: Boolean = true) = accounts.refresh(showError)

    fun saveNickname() = accounts.saveNickname()

    fun uploadAvatar(uri: Uri) = accounts.uploadAvatar(uri)

    fun setInitialPassword(password: String) = accounts.setInitialPassword(password)

    fun updateAccountId(accountId: String, currentPassword: String?) =
        accounts.updateAccountId(accountId, currentPassword)

    fun loginIdentity(accountId: String, password: String) = accounts.login(accountId, password)

    fun logoutIdentity() = accounts.logout()

    fun loadAdminData() = accounts.loadAdminData()

    fun deleteAdminUser(userId: String) = accounts.deleteAdminUser(userId)

    fun resetAdminPassword(userId: String, password: String) =
        accounts.resetAdminPassword(userId, password)

    fun dissolveAdminRoom(roomId: String) = accounts.dissolveAdminRoom(roomId)

    fun updateKugouForceProxy(enabled: Boolean) = accounts.updateKugouForceProxy(enabled)

    fun updateRoomAudioQuality(quality: String) {
        val value: Any = quality.toIntOrNull() ?: quality
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("audioQuality", value))
    }

    fun updateRoomHidden(hidden: Boolean) {
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("hidden", hidden))
    }

    fun updateRoomPermanent(permanent: Boolean) {
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("permanent", permanent))
    }

    fun updateTemporaryAdminTrackRemoval(enabled: Boolean) {
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("allowTemporaryAdminTrackRemoval", enabled))
    }

    fun updateTemporaryAdminQueueClear(enabled: Boolean) {
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("allowTemporaryAdminQueueClear", enabled))
    }

    fun updatePlaybackTempoSync(enabled: Boolean) {
        appPreferences.setPlaybackTempoSync(enabled)
        _state.value = _state.value.copy(playbackTempoSyncEnabled = enabled)
        nativePlayer.setTempoSyncEnabled(enabled)
    }

    fun updatePlaybackHardSeekSync(enabled: Boolean) {
        appPreferences.setPlaybackHardSeekSync(enabled)
        _state.value = _state.value.copy(playbackHardSeekSyncEnabled = enabled)
        nativePlayer.setHardSeekSyncEnabled(enabled)
    }

    fun updateSyncPacketInterval(seconds: Int) {
        val value = seconds.coerceIn(MIN_SYNC_PACKET_INTERVAL_SECONDS, MAX_SYNC_PACKET_INTERVAL_SECONDS)
        if (value == _state.value.syncPacketIntervalSeconds) return
        appPreferences.setSyncPacketInterval(value)
        _state.value = _state.value.copy(syncPacketIntervalSeconds = value)
        if (_state.value.connectionStatus == ConnectionStatus.Connected) {
            stopPeriodicJobs()
            startPeriodicJobs()
        }
    }

    fun copyRoomLink() {
        val room = _state.value.room ?: return
        val server = activeServer ?: return setError("请先连接服务端")
        val link = "${server.displayUrl}/room/${room.id}"
        val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Music Together 房间链接", link))
        showNotice("房间链接已复制")
    }

    fun connect() {
        val parsed = ServerAddress.parse(_state.value.serverUrl)
        if (parsed == null) {
            setError("请输入有效的服务端 URL")
            return
        }
        pendingRoomCreation = null
        connectToServer(parsed, keepDesiredRoom = false)
    }

    fun selectServer(serverUrl: String) {
        val server = ServerAddress.parse(serverUrl) ?: return setError("服务端地址无效")
        pendingRoomCreation = null
        if (activeServer?.displayUrl == server.displayUrl && _state.value.connectionStatus == ConnectionStatus.Connected) {
            _state.value = _state.value.copy(serverUrl = server.displayUrl, selectedServerUrl = server.displayUrl)
            return
        }
        connectToServer(server, keepDesiredRoom = false)
    }

    fun removeServer(serverUrl: String) {
        val normalized = ServerAddress.parse(serverUrl)?.displayUrl ?: return
        val remaining = _state.value.servers.filterNot { it.url == normalized }
        if (remaining.isEmpty()) return setError("至少保留一个服务器")
        discovery.remove(normalized)
        appPreferences.persistServers(remaining.map(ServerConnection::url))
        _state.value = _state.value.copy(servers = remaining)
        if (activeServer?.displayUrl == normalized) selectServer(remaining.first().url)
    }

    fun joinRoomOnServer(serverUrl: String, roomId: String, password: String = "") {
        val server = ServerAddress.parse(serverUrl) ?: return setError("服务端地址无效")
        if (!requireNickname()) return
        AppLogger.info(
            "Room",
            "selected room=$roomId targetServer=${server.displayUrl} activeServer=${activeServer?.displayUrl}",
        )
        desiredRoomId = roomId
        desiredRoomPassword = password
        pendingRoomCreation = null
        if (activeServer?.displayUrl == server.displayUrl && _state.value.connectionStatus == ConnectionStatus.Connected) {
            accounts.withPersistedNickname { emitJoin(roomId, password) }
        } else {
            connectToServer(server, keepDesiredRoom = true)
        }
    }

    private fun connectToServer(
        parsed: ServerAddress,
        keepDesiredRoom: Boolean,
        resetReconnectAttempts: Boolean = true,
    ) {
        if (_state.value.servers.none { it.url == parsed.displayUrl } && _state.value.servers.size >= MAX_SERVERS) {
            setError("最多同时连接 $MAX_SERVERS 台服务器")
            return
        }
        if (resetReconnectAttempts) reconnectBackoff.reset()
        AppLogger.info("Connection", "connect server=${parsed.displayUrl}")
        shouldReconnect = true
        reconnectJob?.cancel()
        reconnectJob = null
        socketServerUrl = null
        socket.disconnect()
        val serverChanged = activeServer?.displayUrl != null && activeServer?.displayUrl != parsed.displayUrl
        activeServer = parsed
        if (serverChanged && !keepDesiredRoom) {
            desiredRoomId = null
            desiredRoomPassword = null
        }
        if (serverChanged) {
            nativePlayer.stop()
            resetPlatformRoomState()
        }
        val serverUrls = ServerCatalog.normalize(_state.value.servers.map(ServerConnection::url) + parsed.displayUrl)
        appPreferences.persistServers(serverUrls)
        discovery.remove(parsed.displayUrl)
        appPreferences.selectServer(parsed.displayUrl)
        val existingServers = _state.value.servers
        val selectedRooms = existingServers.firstOrNull { it.url == parsed.displayUrl }?.rooms.orEmpty()
        _state.value = _state.value.copy(
            serverUrl = parsed.displayUrl,
            selectedServerUrl = parsed.displayUrl,
            servers = serverUrls.map { url ->
                existingServers.firstOrNull { it.url == url }
                    ?.let { existing ->
                        existing.copy(
                            status = if (url == parsed.displayUrl) ConnectionStatus.Connecting else existing.status,
                            error = null,
                        )
                    }
                    ?: ServerConnection(url, if (url == parsed.displayUrl) ConnectionStatus.Connecting else ConnectionStatus.Disconnected)
            },
            connectionStatus = ConnectionStatus.Connecting,
            rooms = selectedRooms,
            room = if (serverChanged) null else _state.value.room,
            accountProfile = if (serverChanged) null else _state.value.accountProfile,
            accountLoading = true,
            adminUsers = if (serverChanged) emptyList() else _state.value.adminUsers,
            adminRooms = if (serverChanged) emptyList() else _state.value.adminRooms,
            audioProxyPolicy = if (serverChanged) AudioProxyPolicy() else _state.value.audioProxyPolicy,
            error = null,
        )
        discovery.sync()
        viewModelScope.launch {
            runCatching { api.bootstrapIdentity(parsed) }
                .onSuccess { userId ->
                    if (activeServer?.displayUrl == parsed.displayUrl) {
                        _state.value = _state.value.copy(userId = userId, accountLoading = true)
                        runCatching { api.currentProfile(parsed) }
                            .onSuccess { profile ->
                                if (activeServer?.displayUrl == parsed.displayUrl) accounts.applyProfile(profile)
                            }
                            .onFailure {
                                if (activeServer?.displayUrl == parsed.displayUrl) {
                                    AppLogger.warn("Account", "profile bootstrap failed: ${it.message}")
                                    _state.value = _state.value.copy(accountLoading = false)
                                }
                            }
                        connectPrimarySocket(parsed)
                    }
                }
                .onFailure { error ->
                    if (activeServer?.displayUrl == parsed.displayUrl) {
                        AppLogger.error("Connection", "identity bootstrap failed server=${parsed.displayUrl}", error)
                        _state.value = _state.value.copy(
                            connectionStatus = ConnectionStatus.Disconnected,
                            accountLoading = false,
                        )
                        updateServerConnection(parsed.displayUrl) { connection ->
                            connection.copy(status = ConnectionStatus.Disconnected, error = error.message ?: "连接失败")
                        }
                        setError(error.message ?: "无法连接服务端")
                        scheduleReconnect()
                    }
                }
        }
    }

    fun disconnect() {
        shouldReconnect = false
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectBackoff.reset()
        stopPeriodicJobs()
        resetPlatformRoomState()
        socket.disconnect()
        socketServerUrl = null
        discovery.disconnectAll()
        _state.value = _state.value.copy(
            connectionStatus = ConnectionStatus.Disconnected,
            servers = _state.value.servers.map { it.copy(status = ConnectionStatus.Disconnected) },
        )
    }

    fun refreshRooms() {
        socket.emit(Events.ROOM_LIST)
        discovery.refreshRooms()
    }

    fun createRoomOnServer(serverUrl: String, roomName: String, password: String) {
        val server = ServerAddress.parse(serverUrl) ?: return setError("服务端地址无效")
        if (!requireNickname()) return
        val creation = PendingRoomCreation(roomName.trim().take(30), password.take(32))
        AppLogger.info(
            "Room",
            "create selected targetServer=${server.displayUrl} activeServer=${activeServer?.displayUrl}",
        )
        desiredRoomId = null
        desiredRoomPassword = null
        if (activeServer?.displayUrl == server.displayUrl && _state.value.connectionStatus == ConnectionStatus.Connected) {
            pendingRoomCreation = null
            emitCreateRoom(creation)
        } else {
            pendingRoomCreation = creation
            connectToServer(server, keepDesiredRoom = false)
        }
    }

    fun createRoom(roomName: String, password: String) {
        createRoomOnServer(_state.value.selectedServerUrl, roomName, password)
    }

    fun joinRoom(roomId: String, password: String = "") {
        joinRoomOnServer(_state.value.selectedServerUrl, roomId, password)
    }

    fun joinRoomInput(input: String, password: String = "") {
        val target = RoomJoinTargetParser.parse(input)
            ?: return setError("请输入有效的房间号或邀请链接")
        val server = target.serverAddress
        if (server == null) {
            joinRoom(target.roomId, password)
        } else {
            joinRoomOnServer(server.displayUrl, target.roomId, password)
        }
    }

    fun leaveRoom() {
        socket.emit(Events.ROOM_LEAVE)
        desiredRoomId = null
        desiredRoomPassword = null
        nativePlayer.stop()
        recoveredTrackId = null
        queueActions.clear()
        chatVisible = false
        chatNotifications.clear()
        dismissBilibiliMetadata()
        resetPlatformRoomState()
        waitingForJoinRoomState = false
        _state.value = _state.value.copy(
            room = null,
            messages = emptyList(),
            chatUnreadCount = 0,
            activeVote = null,
        )
    }

    fun search(keyword: String, source: String) {
        if (keyword.isBlank()) return
        val query = normalizeSearchKeyword(keyword, source)
        searchJob?.cancel()
        _state.value = _state.value.copy(
            searchLoading = true,
            searchLoadingMore = false,
            searchHasSearched = true,
            searchHasMore = false,
            searchPage = 0,
            searchKeyword = query,
            searchSource = source,
            searchError = null,
            searchResults = emptyList(),
        )
        requestSearchPage(query, source, page = 1, append = false)
    }

    fun loadMoreSearch() {
        val current = _state.value
        if (
            current.searchLoading || current.searchLoadingMore || !current.searchHasMore ||
            current.searchKeyword.isBlank()
        ) return
        requestSearchPage(
            current.searchKeyword,
            current.searchSource,
            page = current.searchPage + 1,
            append = true,
        )
    }

    fun loadRecommendations() = requestRecommendations(append = false)

    fun loadMoreRecommendations() {
        val pagination = _state.value.recommendations
            .firstOrNull { it.platform == "tencent" }
            ?.pagination
            ?: return
        if (pagination.tracks?.hasMore != true && pagination.playlists?.hasMore != true) return
        requestRecommendations(append = true)
    }

    private fun requestRecommendations(append: Boolean) {
        val room = _state.value.room ?: return
        val server = activeServer ?: return
        val roomId = room.id
        val pagination = _state.value.recommendations
            .firstOrNull { it.platform == "tencent" }
            ?.pagination
        if (append && (pagination?.tracks?.hasMore != true && pagination?.playlists?.hasMore != true)) return
        recommendationsJob?.cancel()
        _state.value = _state.value.copy(
            recommendationsLoading = !append,
            recommendationsLoadingMore = append,
            recommendationsError = null,
        )
        AppLogger.info("Recommendations", "load room=$roomId append=$append")
        recommendationsJob = viewModelScope.launch {
            runCatching {
                api.recommendations(
                    server = server,
                    roomId = roomId,
                    radarPage = if (append) pagination?.tracks?.nextPage ?: 1 else 1,
                    playlistOffset = if (append) pagination?.playlists?.nextOffset ?: 0 else 0,
                )
            }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { recommendations ->
                    if (_state.value.room?.id != roomId) return@onSuccess
                    _state.value = _state.value.copy(
                        recommendations = if (append) {
                            mergeTencentRecommendationPages(_state.value.recommendations, recommendations)
                        } else {
                            recommendations
                        },
                        recommendationsLoading = false,
                        recommendationsLoadingMore = false,
                        recommendationsLoaded = true,
                        recommendationsError = null,
                    )
                    AppLogger.info("Recommendations", "loaded room=$roomId platforms=${recommendations.size}")
                }
                .onFailure {
                    if (_state.value.room?.id != roomId) return@onFailure
                    AppLogger.error("Recommendations", "load failed room=$roomId", it)
                    _state.value = _state.value.copy(
                        recommendations = if (append) _state.value.recommendations else emptyList(),
                        recommendationsLoading = false,
                        recommendationsLoadingMore = false,
                        recommendationsLoaded = true,
                        recommendationsError = it.message ?: "推荐加载失败",
                    )
                }
        }
    }

    fun addTrack(track: Track) {
        if (rejectDuplicateQueueTrack(track)) return
        if (track.source == "bilibili") beginBilibiliCollectionMatch(track, pinned = false)
        else emitSearchQueueAction(track, pinned = false)
    }

    fun insertAfterCurrent(track: Track) {
        if (rejectDuplicateQueueTrack(track)) return
        if (track.source == "bilibili") beginBilibiliCollectionMatch(track, pinned = true)
        else emitSearchQueueAction(track, pinned = true)
    }

    fun reselectBilibiliMetadata(track: Track) {
        if (track.source != "bilibili") return
        beginBilibiliMetadataMatch(track, pinned = false, queueTrackId = track.id)
    }

    fun searchBilibiliMetadata(keyword: String, source: String) {
        val match = _state.value.bilibiliMetadataMatch
        if (match.track == null || source !in BILIBILI_METADATA_SOURCES || keyword.isBlank()) return
        requestBilibiliMetadataSearch(match.copy(source = source, keyword = keyword.trim().take(100)))
    }

    fun selectBilibiliCollection(track: Track) {
        val match = _state.value.bilibiliCollection
        val original = match.track ?: return
        bilibiliCollectionJob?.cancel()
        _state.value = _state.value.copy(bilibiliCollection = BilibiliCollectionState())
        beginBilibiliMetadataMatch(
            track = track.copy(
                // Keep the queue action context while using the selected page's
                // CID-bearing urlId and metadata from that page.
                bilibiliCover = track.bilibiliCover ?: original.bilibiliCover,
            ),
            pinned = match.pinned,
            queueTrackId = match.queueTrackId,
        )
    }

    fun skipBilibiliCollection() {
        val match = _state.value.bilibiliCollection
        val track = match.track ?: return
        bilibiliCollectionJob?.cancel()
        _state.value = _state.value.copy(bilibiliCollection = BilibiliCollectionState())
        beginBilibiliMetadataMatch(track, match.pinned, match.queueTrackId)
    }

    fun dismissBilibiliCollection() {
        bilibiliCollectionJob?.cancel()
        _state.value = _state.value.copy(bilibiliCollection = BilibiliCollectionState())
    }

    fun selectBilibiliMetadata(metadataTrack: Track) {
        val match = _state.value.bilibiliMetadataMatch
        val track = match.track ?: return
        val resolvedTrack = track.copy(
            metadataSource = match.source,
            lyricId = metadataTrack.lyricId,
            picId = metadataTrack.picId,
            cover = metadataTrack.cover.ifBlank { track.cover },
        )
        _state.value = _state.value.copy(bilibiliMetadataMatch = BilibiliMetadataMatchState())
        if (match.queueTrackId != null) {
            emitBilibiliMetadataUpdate(
                trackId = match.queueTrackId,
                metadataSource = match.source,
                lyricId = resolvedTrack.lyricId,
                picId = resolvedTrack.picId,
                cover = resolvedTrack.cover,
            )
        } else {
            emitSearchQueueAction(resolvedTrack, match.pinned)
        }
    }

    fun skipBilibiliMetadata() {
        val match = _state.value.bilibiliMetadataMatch
        val track = match.track ?: return
        _state.value = _state.value.copy(bilibiliMetadataMatch = BilibiliMetadataMatchState())
        if (match.queueTrackId != null) emitBilibiliMetadataUpdate(trackId = match.queueTrackId, clearMetadata = true)
        else emitSearchQueueAction(track, match.pinned)
    }

    fun dismissBilibiliMetadata() {
        bilibiliMetadataSearchJob?.cancel()
        _state.value = _state.value.copy(bilibiliMetadataMatch = BilibiliMetadataMatchState())
    }

    fun requestPlatformStatus() {
        socket.emit(Events.AUTH_GET_STATUS)
    }

    fun requestQrLogin(platform: String) {
        if (platform !in supportedPlatforms) return
        qrPollJob?.cancel()
        qrCloseJob?.cancel()
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                qr = QrLoginState(open = true, platform = platform, loading = true),
            ),
        )
        val sent = socket.emit(Events.AUTH_REQUEST_QR, JSONObject().put("platform", platform))
        AppLogger.info("Auth", "request QR platform=$platform sent=$sent")
        if (!sent) {
            _state.value = _state.value.copy(
                platformHub = _state.value.platformHub.copy(
                    qr = QrLoginState(
                        open = true,
                        platform = platform,
                        status = QR_EXPIRED,
                        message = "二维码请求未发送，请检查连接",
                    ),
                ),
            )
        }
    }

    fun closeQrLogin() {
        qrPollJob?.cancel()
        qrCloseJob?.cancel()
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(qr = QrLoginState()),
        )
    }

    fun loginWithPlatformCookie(platform: String, cookie: String) {
        val safeCookie = cookie.trim()
        if (platform !in supportedPlatforms || safeCookie.isBlank()) return
        val sent = socket.emit(
            Events.AUTH_SET_COOKIE,
            JSONObject().put("platform", platform).put("cookie", safeCookie),
        )
        AppLogger.info("Auth", "manual cookie login platform=$platform sent=$sent")
        if (!sent) setNotice("登录请求未发送，请检查连接", isError = true)
    }

    fun logoutPlatform(platform: String) {
        if (platform !in supportedPlatforms) return
        appPreferences.removePlatformCookie(activeServer?.displayUrl.orEmpty(), platform)
        loadedPlaylistPlatforms.remove(platform)
        socket.emit(Events.AUTH_LOGOUT, JSONObject().put("platform", platform))
        val hub = _state.value.platformHub
        _state.value = _state.value.copy(
            platformHub = hub.copy(
                myAuth = hub.myAuth.filterNot { it.platform == platform },
                playlists = hub.playlists + (platform to emptyList()),
            ),
            notice = UiNotice(text = "已退出${platformLabel(platform)}账号"),
        )
        AppLogger.info("Auth", "logout platform=$platform")
    }

    fun claimKugouConceptVip() {
        val hub = _state.value.platformHub
        if (hub.claimingKugouConceptVip) return
        _state.value = _state.value.copy(
            platformHub = hub.copy(claimingKugouConceptVip = true),
        )
        if (!socket.emit(Events.AUTH_CLAIM_KUGOU_CONCEPT_VIP)) {
            _state.value = _state.value.copy(
                platformHub = _state.value.platformHub.copy(claimingKugouConceptVip = false),
            )
            setNotice("权益领取请求未发送，请检查连接", isError = true)
        }
    }

    fun fetchMyPlaylists(platform: String) {
        if (platform !in supportedPlatforms) return
        val hub = _state.value.platformHub
        if (platform in hub.playlistsLoading) return
        _state.value = _state.value.copy(
            platformHub = hub.copy(playlistsLoading = hub.playlistsLoading + platform),
        )
        val sent = socket.emit(Events.PLAYLIST_GET_MY, JSONObject().put("platform", platform))
        AppLogger.info("Playlist", "get my platform=$platform sent=$sent")
        if (!sent) {
            _state.value = _state.value.copy(
                platformHub = _state.value.platformHub.copy(
                    playlistsLoading = _state.value.platformHub.playlistsLoading - platform,
                ),
            )
            setNotice("歌单请求未发送，请检查连接", isError = true)
        }
    }

    fun openPlaylist(playlist: Playlist) {
        val room = _state.value.room ?: return
        val server = activeServer ?: return
        playlistJob?.cancel()
        playlistAddAllJob?.cancel()
        playlistContext = PlaylistContext(playlist.source, playlist.id, room.id)
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                selectedPlaylist = playlist,
                playlistTracks = emptyList(),
                playlistTotal = 0,
                playlistHasMore = false,
                playlistLoading = true,
                playlistLoadingMore = false,
                playlistAddingAll = false,
                playlistError = null,
            ),
        )
        requestPlaylistPage(server, playlist, room.id, offset = 0, append = false)
    }

    fun closePlaylist() {
        playlistJob?.cancel()
        playlistAddAllJob?.cancel()
        playlistContext = null
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                selectedPlaylist = null,
                playlistTracks = emptyList(),
                playlistTotal = 0,
                playlistHasMore = false,
                playlistLoading = false,
                playlistLoadingMore = false,
                playlistAddingAll = false,
                playlistError = null,
            ),
        )
    }

    fun loadMorePlaylistTracks() {
        val hub = _state.value.platformHub
        val playlist = hub.selectedPlaylist ?: return
        val context = playlistContext ?: return
        val server = activeServer ?: return
        if (hub.playlistLoading || hub.playlistLoadingMore || hub.playlistAddingAll || !hub.playlistHasMore) return
        requestPlaylistPage(server, playlist, context.roomId, hub.playlistTracks.size, append = true)
    }

    fun addPlaylistTracksToQueue(playlist: Playlist) {
        val room = _state.value.room ?: return
        val server = activeServer ?: return
        val expected = PlaylistContext(playlist.source, playlist.id, room.id)
        if (playlistContext != expected || _state.value.platformHub.playlistAddingAll) return
        playlistJob?.cancel()
        playlistAddAllJob?.cancel()
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                playlistLoadingMore = false,
                playlistAddingAll = true,
                playlistError = null,
            ),
        )
        playlistAddAllJob = viewModelScope.launch {
            var knownTotal: Int? = playlist.trackCount.takeIf { it > 0 }
            runCatching {
                loadCompletePlaylist(
                    loadPage = { offset ->
                        api.playlist(
                            server = server,
                            source = playlist.source,
                            id = playlist.id,
                            roomId = room.id,
                            offset = offset,
                            total = knownTotal,
                        )
                    },
                    onPageLoaded = { tracks, total, hasMore ->
                        if (playlistContext != expected) return@loadCompletePlaylist
                        knownTotal = total.takeIf { it > 0 }
                        _state.value = _state.value.copy(
                            platformHub = _state.value.platformHub.copy(
                                playlistTracks = tracks,
                                playlistTotal = total,
                                playlistHasMore = hasMore,
                                playlistLoading = false,
                                playlistLoadingMore = false,
                                playlistError = null,
                            ),
                        )
                    },
                )
            }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { allTracks ->
                    if (playlistContext != expected || _state.value.room?.id != room.id) return@onSuccess
                    val currentRoom = _state.value.room ?: return@onSuccess
                    val queueKeys = currentRoom.queue.mapTo(hashSetOf()) { it.queueIdentity() }
                    val pendingKeys = queueActions.reservedKeys(queueKeys)
                    val plan = planPlaylistQueueBatches(
                        tracks = allTracks,
                        queueKeys = queueKeys,
                        pendingKeys = pendingKeys,
                        queueSize = currentRoom.queue.size,
                        maxQueueSize = MAX_QUEUE_SIZE,
                        maxBatchSize = MAX_QUEUE_BATCH_SIZE,
                    )
                    if (plan.batches.isEmpty()) {
                        val queueFull = currentRoom.queue.size + pendingKeys.size >= MAX_QUEUE_SIZE
                        _state.value = _state.value.copy(
                            platformHub = _state.value.platformHub.copy(playlistAddingAll = false),
                        )
                        setNotice(if (queueFull) "播放队列已满" else "歌单中的歌曲已全部在队列或待确认列表中")
                        return@onSuccess
                    }

                    var sentCount = 0
                    var allSent = true
                    for (batch in plan.batches) {
                        val sent = socket.emit(
                            Events.QUEUE_ADD_BATCH,
                            JSONObject()
                                .put("tracks", JSONArray(batch.map { it.toJson() }))
                                .put("playlistName", playlist.name),
                        )
                        if (!sent) {
                            allSent = false
                            break
                        }
                        queueActions.reserveAll(batch.map { it.queueIdentity() })
                        sentCount += batch.size
                    }
                    _state.value = _state.value.copy(
                        platformHub = _state.value.platformHub.copy(playlistAddingAll = false),
                    )
                    AppLogger.info(
                        "Queue",
                        "playlist all=${allTracks.size} sent=$sentCount source=${playlist.source} success=$allSent",
                    )
                    val capacitySuffix = if (plan.skippedForCapacity > 0) {
                        "，队列容量不足，另有 ${plan.skippedForCapacity} 首未提交"
                    } else {
                        ""
                    }
                    setNotice(
                        if (allSent) {
                            "已提交 $sentCount 首歌曲到播放队列$capacitySuffix"
                        } else {
                            "已提交 $sentCount 首，后续批次发送失败，请检查连接"
                        },
                        isError = !allSent,
                    )
                }
                .onFailure { error ->
                    if (playlistContext != expected) return@onFailure
                    AppLogger.error("Playlist", "load all failed source=${playlist.source}", error)
                    _state.value = _state.value.copy(
                        platformHub = _state.value.platformHub.copy(
                            playlistAddingAll = false,
                            playlistError = error.message ?: "完整歌单加载失败",
                        ),
                    )
                    setNotice(error.message ?: "完整歌单加载失败，请重试", isError = true)
                }
        }
    }

    fun playTrack(track: Track) {
        if (canControl()) {
            socket.emit(Events.PLAYER_PLAY, JSONObject().put("track", track.toJson()))
        } else {
            startVote(
                "play-track",
                JSONObject().put("trackId", track.id).put("trackTitle", track.title),
            )
        }
    }

    fun downloadTrack(track: Track) {
        val key = track.offlineDownloadKey()
        if (offlineDownloadJobs[key]?.isActive == true) return
        if (offlineLibrary.playbackUrlFor(track) != null) {
            setNotice("《${track.title}》已下载")
            return
        }
        if (activeServer == null && track.streamUrl.isNullOrBlank()) {
            return setError("请先连接服务器后下载歌曲")
        }
        updateOfflineLibrary { library ->
            library.copy(downloads = library.downloads + (key to OfflineDownloadState(track = track)))
        }
        offlineDownloadJobs[key] = viewModelScope.launch {
            runCatching {
                val resolvedTrack = resolveTrackForDownload(track)
                val target = playbackTarget(resolvedTrack) ?: throw IOException("服务端未返回可下载音频")
                fun updateProgress(progress: Int?) {
                    updateOfflineLibrary { library ->
                        val current = library.downloads[key] ?: return@updateOfflineLibrary library
                        library.copy(downloads = library.downloads + (key to current.copy(progressPercent = progress)))
                    }
                }
                try {
                    offlineLibrary.download(track, target.primaryUrl, ::updateProgress)
                } catch (primaryError: Throwable) {
                    val fallbackUrl = target.fallbackUrl ?: throw primaryError
                    AppLogger.warn("Offline", "primary download failed; retrying fallback track=${track.id}")
                    offlineLibrary.download(track, fallbackUrl, ::updateProgress)
                }
            }.onSuccess {
                updateOfflineLibrary { library ->
                    library.copy(
                        tracks = offlineLibrary.tracks(),
                        downloads = library.downloads - key,
                    )
                }
                setNotice("《${track.title}》已下载")
            }.onFailure { error ->
                if (error is CancellationException) throw error
                updateOfflineLibrary { library -> library.copy(downloads = library.downloads - key) }
                setNotice("《${track.title}》下载失败：${error.message ?: "未知错误"}", isError = true)
            }
            offlineDownloadJobs.remove(key)
        }
    }

    fun removeDownloadedTrack(track: Track) {
        val key = track.offlineDownloadKey()
        offlineDownloadJobs.remove(key)?.cancel()
        val removed = offlineLibrary.remove(track)
        if (!removed) return
        if (nativePlayer.state.value.localPlayback && nativePlayer.state.value.track?.offlineDownloadKey() == key) {
            nativePlayer.stop()
        }
        updateOfflineLibrary { it.copy(tracks = offlineLibrary.tracks(), downloads = it.downloads - key) }
        setNotice("已删除《${track.title}》")
    }

    fun playDownloadedTrack(track: Track) {
        if (_state.value.room != null) {
            setNotice("请先离开房间后播放本地音乐", isError = true)
            return
        }
        val playbackUrl = offlineLibrary.playbackUrlFor(track)
            ?: return setNotice("本地音频不存在，请重新下载", isError = true)
        nativePlayer.load(
            track = track,
            playState = PlayState(isPlaying = true),
            playbackUrl = playbackUrl,
            localPlayback = true,
        )
    }

    fun removeTrack(track: Track) {
        if (canRemoveQueueTrack()) {
            socket.emit(Events.QUEUE_REMOVE, JSONObject().put("trackId", track.id))
        } else {
            startVote(
                "remove-track",
                JSONObject().put("trackId", track.id).put("trackTitle", track.title),
            )
        }
    }

    fun clearQueue() {
        if (!canClearQueue()) return
        val sent = socket.emit(Events.QUEUE_CLEAR)
        if (sent) {
            queueActions.clear()
        }
        setNotice(
            if (sent) "播放列表已清空" else "清空播放列表失败，请检查连接",
            isError = !sent,
        )
    }

    fun moveTrack(track: Track, offset: Int) {
        if (!canControl() || offset == 0) return
        val queue = _state.value.room?.queue.orEmpty()
        val from = queue.indexOfFirst { it.id == track.id }
        val to = from + offset
        if (from < 0 || to !in queue.indices) return
        val reordered = queue.toMutableList()
        val moved = reordered.removeAt(from)
        reordered.add(to, moved)
        emitQueueOrder(reordered, "已调整《${track.title}》的位置")
    }

    fun pinTrack(track: Track) {
        if (!canControl()) return
        val room = _state.value.room ?: return
        if (track.id == room.currentTrack?.id) return
        val reordered = room.queue.toMutableList()
        val from = reordered.indexOfFirst { it.id == track.id }
        if (from < 0) return
        val moved = reordered.removeAt(from)
        val currentIndex = reordered.indexOfFirst { it.id == room.currentTrack?.id }
        reordered.add(if (currentIndex >= 0) currentIndex + 1 else 0, moved)
        emitQueueOrder(reordered, "已置顶《${track.title}》")
    }

    fun togglePlayback() {
        if (nativePlayer.state.value.localPlayback) {
            nativePlayer.toggleLocalPlayback()
            return
        }
        val action = if (nativePlayer.state.value.playing) "pause" else "resume"
        if (canControl()) {
            socket.emit(if (action == "pause") Events.PLAYER_PAUSE else Events.PLAYER_PLAY)
        } else {
            startVote(action)
        }
    }

    fun next() {
        if (!nativePlayer.state.value.localPlayback) controlOrVote(Events.PLAYER_NEXT, "next")
    }

    fun previous() {
        if (!nativePlayer.state.value.localPlayback) controlOrVote(Events.PLAYER_PREV, "prev")
    }

    fun seek(seconds: Double) {
        if (nativePlayer.state.value.localPlayback) {
            nativePlayer.seekLocal(seconds)
            return
        }
        if (canControl()) socket.emit(Events.PLAYER_SEEK, JSONObject().put("currentTime", seconds.coerceAtLeast(0.0)))
    }

    fun setLyricOffset(track: Track?, offsetMs: Int) {
        val key = lyricOffsetKey(track) ?: return
        val value = offsetMs.coerceIn(-10_000, 10_000)
        val lyricOffsets = _state.value.lyricOffsets.toMutableMap()
        if (value == 0) lyricOffsets.remove(key) else lyricOffsets[key] = value
        appPreferences.persistLyricOffsets(lyricOffsets)
        _state.value = _state.value.copy(lyricOffsets = lyricOffsets)
    }

    fun setPlayMode(mode: String) {
        val description = playModeDescription(mode)
        if (canControl()) {
            socket.emit(Events.PLAYER_SET_MODE, JSONObject().put("mode", mode))
        } else {
            startVote("set-mode", JSONObject().put("mode", mode), description)
        }
    }

    fun sendChat(content: String) {
        val safe = content.trim().take(500)
        if (safe.isNotEmpty()) socket.emit(Events.CHAT_MESSAGE, JSONObject().put("content", safe))
    }

    fun setAppForeground(foreground: Boolean) {
        val resumed = foreground && !appInForeground
        appInForeground = foreground
        if (foreground && chatVisible) chatNotifications.clear()
        if (resumed && _state.value.connectionStatus == ConnectionStatus.Connected) {
            viewModelScope.launch {
                repeat(5) { index ->
                    sendClockPing()
                    if (index < 4) delay(50)
                }
            }
            if (nativePlayer.state.value.playing) {
                socket.emit(Events.PLAYER_SYNC_REQUEST)
                viewModelScope.launch {
                    delay(250)
                    if (nativePlayer.state.value.playing) socket.emit(Events.PLAYER_SYNC_REQUEST)
                }
            }
        }
    }

    fun setChatVisible(visible: Boolean) {
        chatVisible = visible
        if (visible) {
            chatNotifications.clear()
            _state.value = _state.value.copy(chatUnreadCount = 0)
        }
    }

    fun castVote(approve: Boolean) = socket.emit(Events.VOTE_CAST, JSONObject().put("approve", approve))

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun clearNotice() {
        _state.value = _state.value.copy(notice = null)
    }

    fun loadMusicDownloadOptions() {
        val room = _state.value.room ?: return
        val track = room.currentTrack ?: return
        val server = activeServer ?: return
        if (musicDownloadJob?.isActive == true && _state.value.musicDownload.trackId == track.id) return
        downloadOptionsJob?.cancel()
        _state.value = _state.value.copy(
            musicDownload = MusicDownloadState(trackId = track.id, optionsLoading = true),
        )
        downloadOptionsJob = viewModelScope.launch {
            runCatching { musicDownloads.options(server, room.id, track.id) }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { response ->
                    if (_state.value.room?.currentTrack?.id != track.id || response.trackId != track.id) return@onSuccess
                    _state.value = _state.value.copy(
                        musicDownload = _state.value.musicDownload.copy(
                            options = response.options,
                            optionsLoading = false,
                            optionsError = null,
                        ),
                    )
                }
                .onFailure { error ->
                    if (_state.value.room?.currentTrack?.id != track.id) return@onFailure
                    _state.value = _state.value.copy(
                        musicDownload = _state.value.musicDownload.copy(
                            optionsLoading = false,
                            optionsError = musicDownloadErrorMessage(error),
                        ),
                    )
                }
        }
    }

    fun updateMusicDownloadDirectory(value: String) {
        val directory = resolveMusicDownloadDirectory(value)
        if (directory == null) {
            setNotice("下载目录必须位于 /storage/emulated/0/Download", isError = true)
            return
        }
        appPreferences.setMusicDownloadDirectory(directory.absolutePath)
        _state.value = _state.value.copy(musicDownloadDirectory = directory.absolutePath)
        setNotice("下载目录已更新")
    }

    fun reportDownloadStoragePermissionDenied() {
        setNotice("需要存储权限才能在此 Android 版本保存音乐", isError = true)
    }

    fun downloadCurrentTrack(quality: String) {
        val room = _state.value.room ?: return
        val track = room.currentTrack ?: return
        val server = activeServer ?: return
        val option = _state.value.musicDownload.options.firstOrNull { it.quality == quality } ?: return
        if (_state.value.musicDownload.trackId != track.id) return
        musicDownloadJob?.cancel()
        _state.value = _state.value.copy(
            musicDownload = _state.value.musicDownload.copy(
                downloadingQuality = quality,
                downloadError = null,
            ),
        )
        musicDownloadJob = viewModelScope.launch {
            var destination: io.github.yueby.musictogether.network.PendingMusicDownload? = null
            try {
                val speedTracker = DownloadSpeedTracker()
                val fallbackName = suggestedMusicFileName(track, option.format)
                val pending = withContext(Dispatchers.IO) {
                    musicDownloadStorage.create(
                        directoryPath = _state.value.musicDownloadDirectory,
                        fileName = fallbackName,
                        mimeType = musicMimeType(option.format),
                    )
                }
                destination = pending
                val result = musicDownloads.download(
                    server = server,
                    roomId = room.id,
                    trackId = track.id,
                    quality = quality,
                    fallbackFileName = fallbackName,
                    output = pending.output,
                    onProgress = { downloadedBytes, totalBytes ->
                        musicDownloadNotifications.showProgress(
                            track.title,
                            downloadedBytes,
                            totalBytes,
                            speedTracker.record(downloadedBytes),
                        )
                    },
                )
                val averageBytesPerSecond = speedTracker.average(result.downloadedBytes)
                withContext(Dispatchers.IO) { pending.complete() }
                withContext(Dispatchers.IO) {
                    offlineLibrary.registerExternal(track, pending.playbackUri, result.downloadedBytes)
                }
                updateOfflineLibrary { it.copy(tracks = offlineLibrary.tracks()) }
                if (_state.value.room?.currentTrack?.id != track.id) return@launch
                _state.value = _state.value.copy(
                    musicDownload = _state.value.musicDownload.copy(
                        downloadingQuality = null,
                        downloadError = null,
                    ),
                )
                setNotice("已保存到 ${pending.displayPath}")
                musicDownloadNotifications.showCompleted(
                    track.title,
                    pending.displayPath,
                    averageBytesPerSecond,
                )
                AppLogger.info("Download", "completed track=${track.id} quality=$quality")
            } catch (error: CancellationException) {
                withContext(NonCancellable + Dispatchers.IO) { runCatching { destination?.abort() } }
                musicDownloadNotifications.showCancelled(track.title)
                throw error
            } catch (error: Throwable) {
                withContext(Dispatchers.IO) { runCatching { destination?.abort() } }
                if (_state.value.room?.currentTrack?.id != track.id) return@launch
                val message = musicDownloadErrorMessage(error)
                _state.value = _state.value.copy(
                    musicDownload = _state.value.musicDownload.copy(
                        downloadingQuality = null,
                        downloadError = message,
                    ),
                )
                musicDownloadNotifications.showFailed(track.title, message)
                AppLogger.error("Download", "failed track=${track.id} quality=$quality", error)
            }
        }
    }

    fun cancelMusicDownload() {
        musicDownloadJob?.cancel()
        musicDownloadJob = null
        _state.value = _state.value.copy(
            musicDownload = _state.value.musicDownload.copy(
                downloadingQuality = null,
                downloadError = "下载已取消，可重新选择音质重试",
            ),
        )
    }

    fun dismissMusicDownload() {
        downloadOptionsJob?.cancel()
        downloadOptionsJob = null
    }

    fun selectUpdateDownloadSource(source: UpdateDownloadSource) {
        appPreferences.setUpdateSource(source)
        _state.value = _state.value.copy(updateSource = source)
    }

    fun checkForAppUpdate(silent: Boolean = false) =
        appUpdates.check(silent = silent, releasesApi = GITHUB_RELEASES_API)

    fun downloadAppUpdate() = appUpdates.download()

    fun installDownloadedUpdate() = appUpdates.install()

    fun clearLogs() {
        val cleared = AppLogger.clear()
        _state.value = _state.value.copy(
            notice = UiNotice(
                text = if (cleared) "客户端日志已清空" else "清空日志失败",
                isError = !cleared,
            ),
        )
        if (cleared) AppLogger.info("App", "log cleared by user")
    }

    fun currentRole(): String? {
        val state = _state.value
        return state.room?.users?.firstOrNull { it.id == state.userId }?.role
    }

    fun canControl(): Boolean {
        val state = _state.value
        val currentUser = state.room?.users?.firstOrNull { it.id == state.userId }
        return currentUser?.role in setOf("owner", "admin") ||
            currentUser?.isServerAdmin == true ||
            state.accountProfile?.role == "admin"
    }

    fun canRemoveQueueTrack(): Boolean {
        val room = _state.value.room ?: return false
        if (!canControl()) return false
        return !isTemporaryAdmin(room) || room.allowTemporaryAdminTrackRemoval
    }

    fun canClearQueue(): Boolean {
        val room = _state.value.room ?: return false
        if (!canControl()) return false
        return !isTemporaryAdmin(room) || room.allowTemporaryAdminQueueClear
    }

    private fun isTemporaryAdmin(room: io.github.yueby.musictogether.model.RoomState): Boolean {
        val currentUser = room.users.firstOrNull { it.id == _state.value.userId } ?: return false
        return room.temporaryAdminUserId == currentUser.id &&
            currentUser.role == "admin" &&
            !currentUser.isServerAdmin &&
            _state.value.accountProfile?.role != "admin"
    }

    private fun updateServerConnection(url: String, transform: (ServerConnection) -> ServerConnection) {
        val current = _state.value
        _state.value = current.copy(
            servers = current.servers.map { if (it.url == url) transform(it) else it },
        )
    }

    override fun onConnected() {
        val connectedServerUrl = socketServerUrl
        viewModelScope.launch {
            if (connectedServerUrl == null || connectedServerUrl != activeServer?.displayUrl) {
                AppLogger.warn(
                    "WebSocket",
                    "ignore mismatched connection socketServer=$connectedServerUrl activeServer=${activeServer?.displayUrl}",
                )
                socket.disconnect()
                socketServerUrl = null
                return@launch
            }
            AppLogger.info("WebSocket", "connected server=${activeServer?.displayUrl}")
            reconnectJob?.cancel()
            reconnectJob = null
            reconnectBackoff.reset()
            _state.value = _state.value.copy(
                connectionStatus = ConnectionStatus.Connected,
                pingMs = null,
                syncDriftSeconds = 0.0,
                error = null,
            )
            activeServer?.displayUrl?.let { url ->
                updateServerConnection(url) { it.copy(status = ConnectionStatus.Connected, error = null) }
            }
            clock.reset()
            lastRtt = null
            startPeriodicJobs()
            socket.emit(Events.ROOM_LIST)
            val creation = pendingRoomCreation
            if (creation != null) {
                pendingRoomCreation = null
                emitCreateRoom(creation)
            } else {
                desiredRoomId?.let { emitJoin(it, desiredRoomPassword.orEmpty()) }
            }
        }
    }

    override fun onDisconnected(reason: String?) {
        val disconnectedServerUrl = socketServerUrl
        viewModelScope.launch {
            if (disconnectedServerUrl != activeServer?.displayUrl) return@launch
            AppLogger.warn("WebSocket", "disconnected reason=${reason.orEmpty()}")
            stopPeriodicJobs()
            clock.reset()
            lastRtt = null
            recoveredTrackId = null
            queueActions.clear()
            resetPlatformRoomState()
            _state.value = _state.value.copy(
                connectionStatus = ConnectionStatus.Disconnected,
                pingMs = null,
                syncDriftSeconds = 0.0,
                audioProxyPolicy = AudioProxyPolicy(),
            )
            activeServer?.displayUrl?.let { url ->
                updateServerConnection(url) { it.copy(status = ConnectionStatus.Disconnected, error = reason) }
            }
            if (shouldReconnect) scheduleReconnect()
        }
    }

    override fun onEvent(event: String, data: Any?) {
        val eventServerUrl = socketServerUrl
        viewModelScope.launch {
            if (eventServerUrl == activeServer?.displayUrl) {
                handleEvent(event, data)
            } else {
                AppLogger.warn(
                    "WebSocket",
                    "ignore event=$event socketServer=$eventServerUrl activeServer=${activeServer?.displayUrl}",
                )
            }
        }
    }

    private fun handleEvent(event: String, data: Any?) {
        if (event != Events.NTP_PONG && event != Events.PLAYER_SYNC_RESPONSE) {
            AppLogger.debug("WebSocket", "received event=$event")
        }
        when (event) {
            "connect_error" -> setError((data as? JSONObject)?.optString("message") ?: "连接认证失败")
            Events.SERVER_AUDIO_PROXY_POLICY -> {
                val value = data as? JSONObject ?: return
                applyAudioProxyPolicy(
                    AudioProxyPolicy(
                        kugouForceProxy = value.optBoolean("kugouForceProxy", true),
                    ),
                )
            }
            Events.ROOM_CREATED -> {
                val value = data as? JSONObject ?: return
                desiredRoomId = value.optString("roomId")
                value.stringOrNull("userId")?.let { userId ->
                    _state.value = _state.value.copy(userId = userId)
                }
                refreshAccount(showError = false)
            }
            Events.ROOM_STATE -> {
                val room = (data as? JSONObject)?.toRoomState()?.let(::resolveRoomAvatarUrls) ?: return
                handleCurrentTrackChanged(room.currentTrack?.id)
                val isJoinSnapshot = waitingForJoinRoomState
                waitingForJoinRoomState = false
                desiredRoomId = room.id
                _state.value = _state.value.copy(
                    room = room,
                    chatUnreadCount = if (isJoinSnapshot) 0 else _state.value.chatUnreadCount,
                )
                if (_state.value.accountProfile == null) refreshAccount(showError = false)
                restorePlatformAccounts(room.id)
                if (room.currentTrack == null) {
                    recoveredTrackId = null
                    lyricJob?.cancel()
                    _state.value = _state.value.copy(lyrics = LyricsState())
                    nativePlayer.stop()
                } else {
                    val needsRecovery = room.currentTrack.streamUrl != null &&
                        nativePlayer.state.value.track?.id != room.currentTrack.id
                    if (needsRecovery) {
                        recoveredTrackId = if (isJoinSnapshot) room.currentTrack.id else null
                        AppLogger.info("Sync", "recover immediately from room state track=${room.currentTrack.id}")
                        loadTrack(room.currentTrack, room.playState)
                    }
                    if (_state.value.lyrics.trackId != room.currentTrack.id) loadLyrics(room.currentTrack)
                }
            }
            Events.ROOM_REJOIN_TOKEN -> {
                val value = data as? JSONObject ?: return
                val roomId = value.optString("roomId")
                val token = value.optString("token")
                val expiresAt = value.optLong("expiresAt")
                appPreferences.saveRoomRejoin(
                    serverUrl = activeServer?.displayUrl.orEmpty(),
                    roomId = roomId,
                    token = token,
                    expiresAt = expiresAt,
                )
            }
            Events.ROOM_LIST_UPDATE -> {
                val rooms = (data as? JSONArray)?.toRoomList().orEmpty()
                _state.value = _state.value.copy(rooms = rooms)
                activeServer?.displayUrl?.let { url ->
                    updateServerConnection(url) { it.copy(rooms = rooms, error = null) }
                }
            }
            Events.ROOM_SETTINGS -> {
                val value = data as? JSONObject ?: return
                updateRoom {
                    it.copy(
                        name = value.optString("name", it.name),
                        temporaryAdminUserId = if (value.has("temporaryAdminUserId")) {
                            value.stringOrNull("temporaryAdminUserId")
                        } else {
                            it.temporaryAdminUserId
                        },
                        hasPassword = value.optBoolean("hasPassword", it.hasPassword),
                        hidden = value.optBoolean("hidden", it.hidden),
                        permanent = value.optBoolean("permanent", it.permanent),
                        allowTemporaryAdminTrackRemoval = value.optBoolean(
                            "allowTemporaryAdminTrackRemoval",
                            it.allowTemporaryAdminTrackRemoval,
                        ),
                        allowTemporaryAdminQueueClear = value.optBoolean(
                            "allowTemporaryAdminQueueClear",
                            it.allowTemporaryAdminQueueClear,
                        ),
                        audioQuality = value.audioQuality("audioQuality", it.audioQuality),
                    )
                }
            }
            Events.ROOM_USER_JOINED -> {
                val user = (data as? JSONObject)?.toUser()?.let(::resolveUserAvatarUrl) ?: return
                val now = System.currentTimeMillis()
                updateRoom { room ->
                    val members = room.members
                    val updatedMembers = if (members.any { it.id == user.id }) {
                        members.map { member ->
                            if (member.id == user.id) {
                                member.copy(
                                    nickname = user.nickname,
                                    role = user.role,
                                    avatarUrl = user.avatarUrl,
                                    isServerAdmin = user.isServerAdmin,
                                    isOnline = true,
                                    lastSeenAt = now,
                                )
                            } else {
                                member
                            }
                        }
                    } else {
                        members + RoomMember(
                            id = user.id,
                            nickname = user.nickname,
                            role = user.role,
                            avatarUrl = user.avatarUrl,
                            isServerAdmin = user.isServerAdmin,
                            isOnline = true,
                            joinedAt = now,
                            lastSeenAt = now,
                        )
                    }
                    room.copy(
                        users = room.users.filterNot { it.id == user.id } + user,
                        members = updatedMembers,
                    )
                }
            }
            Events.ROOM_USER_LEFT -> {
                val userId = (data as? JSONObject)?.stringOrNull("id") ?: return
                val now = System.currentTimeMillis()
                updateRoom { room ->
                    room.copy(
                        users = room.users.filterNot { it.id == userId },
                        members = room.members.map { member ->
                            if (member.id == userId) member.copy(isOnline = false, lastSeenAt = now) else member
                        },
                    )
                }
            }
            Events.ROOM_ROLE_CHANGED -> {
                val value = data as? JSONObject ?: return
                val userId = value.stringOrNull("userId") ?: return
                val role = value.stringOrNull("role") ?: return
                updateRoom { room ->
                    room.copy(
                        users = room.users.map { user -> if (user.id == userId) user.copy(role = role) else user },
                        members = room.members.map { member ->
                            if (member.id == userId) member.copy(role = role) else member
                        },
                    )
                }
            }
            Events.ROOM_ERROR -> {
                val wasJoining = waitingForJoinRoomState
                waitingForJoinRoomState = false
                val message = (data as? JSONObject)?.optString("message") ?: "房间操作失败"
                if (wasJoining) {
                    val failedRoomId = desiredRoomId
                    AppLogger.warn(
                        "Room",
                        "join failed room=${failedRoomId.orEmpty()} server=${socketServerUrl.orEmpty()} message=$message",
                    )
                    if (failedRoomId != null && message.contains("不存在")) {
                        _state.value = _state.value.copy(rooms = _state.value.rooms.filterNot { it.id == failedRoomId })
                        socketServerUrl?.let { url ->
                            updateServerConnection(url) { connection ->
                                connection.copy(rooms = connection.rooms.filterNot { it.id == failedRoomId })
                            }
                        }
                        socket.emit(Events.ROOM_LIST)
                    }
                    desiredRoomId = null
                    desiredRoomPassword = null
                }
                if (queueActions.hasPending()) {
                    queueActions.clear()
                    setError("点歌失败：$message")
                } else {
                    setError(message)
                }
            }
            Events.QUEUE_UPDATED -> {
                val queueJson = (data as? JSONObject)?.optJSONArray("queue") ?: JSONArray()
                val queue = List(queueJson.length()) { index -> queueJson.getJSONObject(index).toTrack() }
                updateRoom { it.copy(queue = queue) }
                val queueKeys = queue.mapTo(hashSetOf()) { it.queueIdentity() }
                val action = queueActions.completePublished(queueKeys)
                if (action != null) {
                    _state.value = _state.value.copy(
                        notice = UiNotice(
                            text = if (action.pinned) "已置顶点歌：《${action.title}》" else "点歌成功：《${action.title}》",
                        ),
                    )
                }
            }
            Events.PLAYER_PLAY -> {
                val value = data as? JSONObject ?: return
                val track = value.optJSONObject("track")?.toTrack() ?: return
                val playState = value.optJSONObject("playState")?.toPlayState() ?: PlayState()
                handleCurrentTrackChanged(track.id)
                updateRoom { it.copy(currentTrack = track, playState = playState) }
                _state.value = _state.value.copy(syncDriftSeconds = 0.0)
                if (_state.value.lyrics.trackId != track.id) loadLyrics(track)
                if (recoveredTrackId == track.id && nativePlayer.state.value.track?.id == track.id) {
                    AppLogger.info("Sync", "skip duplicate join PLAYER_PLAY track=${track.id}")
                    recoveredTrackId = null
                } else {
                    loadTrack(track, playState)
                }
            }
            Events.PLAYER_TRACK_METADATA_UPDATED -> {
                val track = (data as? JSONObject)?.optJSONObject("track")?.toTrack() ?: return
                updateRoom { it.copy(currentTrack = track) }
                nativePlayer.updateTrackMetadata(track)
                loadLyrics(track)
            }
            Events.PLAYER_PAUSE -> handleScheduledState(data) { nativePlayer.pause(it) }
            Events.PLAYER_RESUME -> handleScheduledState(data) { nativePlayer.resume(it) }
            Events.PLAYER_SEEK -> handleScheduledState(data) { nativePlayer.seek(it) }
            Events.PLAYER_SYNC_RESPONSE -> {
                val value = data as? JSONObject ?: return
                if (!clock.calibrated) return
                val serverTimestamp = value.optLong("serverTimestamp")
                val networkDelay = ((clock.serverTime() - serverTimestamp) / 1000.0).coerceIn(0.0, 5.0)
                val expected = value.optDouble("currentTime") + if (value.optBoolean("isPlaying")) networkDelay else 0.0
                nativePlayer.correctDrift(expected, value.optBoolean("isPlaying"), clock.medianRtt)?.let { drift ->
                    _state.value = _state.value.copy(syncDriftSeconds = drift)
                }
            }
            Events.CHAT_HISTORY -> {
                val array = data as? JSONArray ?: JSONArray()
                _state.value = _state.value.copy(
                    messages = List(array.length()) { array.getJSONObject(it).toChatMessage() },
                    chatUnreadCount = 0,
                )
            }
            Events.CHAT_MESSAGE -> {
                val message = (data as? JSONObject)?.toChatMessage() ?: return
                val current = _state.value
                _state.value = current.copy(
                    messages = (current.messages + message).takeLast(200),
                    chatUnreadCount = nextChatUnreadCount(
                        currentCount = current.chatUnreadCount,
                        message = message,
                        currentUserId = current.userId,
                        chatVisible = chatVisible,
                    ),
                )
                if (
                    message.type == "user" &&
                    message.userId != _state.value.userId &&
                    (!appInForeground || !chatVisible)
                ) {
                    chatNotifications.show(_state.value.room?.name ?: "Music Together", message)
                }
            }
            Events.VOTE_STARTED -> {
                val vote = (data as? JSONObject)?.toVoteState() ?: return
                AppLogger.info("Vote", "started id=${vote.id} action=${vote.action} initiator=${vote.initiatorId}")
                _state.value = _state.value.copy(activeVote = vote)
            }
            Events.VOTE_RESULT -> {
                val value = data as? JSONObject
                val vote = _state.value.activeVote
                val action = value?.optString("action")?.takeIf { it.isNotBlank() } ?: vote?.action.orEmpty()
                val passed = value?.optBoolean("passed") == true
                val reason = value?.optString("reason").orEmpty()
                val resultText = if (passed) {
                    "投票通过：${voteActionLabel(action)}"
                } else {
                    "投票未通过：${voteActionLabel(action)}（${voteReasonLabel(reason)}）"
                }
                AppLogger.info("Vote", "result action=$action passed=$passed reason=$reason")
                _state.value = _state.value.copy(
                    activeVote = null,
                    notice = UiNotice(text = resultText, isError = !passed),
                )
            }
            Events.AUTH_QR_GENERATED -> {
                val value = data as? JSONObject ?: return
                val key = value.optString("key")
                val image = value.optString("qrimg")
                if (key.isBlank() || image.isBlank()) return
                val current = _state.value.platformHub.qr
                _state.value = _state.value.copy(
                    platformHub = _state.value.platformHub.copy(
                        qr = current.copy(
                            key = key,
                            imageData = image,
                            status = QR_WAITING_SCAN,
                            message = "等待扫码",
                            loading = false,
                        ),
                    ),
                )
                startQrPolling(current.platform, key)
                AppLogger.info("Auth", "QR generated platform=${current.platform}")
            }
            Events.AUTH_QR_STATUS -> {
                val value = data as? JSONObject ?: return
                val status = value.optInt("status")
                val current = _state.value.platformHub.qr
                val responseKey = value.stringOrNull("key")
                if (!current.open || (responseKey != null && responseKey != current.key)) return
                if (current.status == QR_EXPIRED || current.status == QR_SUCCESS) return
                _state.value = _state.value.copy(
                    platformHub = _state.value.platformHub.copy(
                        qr = current.copy(
                            status = status,
                            message = value.optString("message"),
                            loading = false,
                        ),
                    ),
                )
                AppLogger.info("Auth", "QR status platform=${current.platform} status=$status")
                if (status == QR_EXPIRED || status == QR_SUCCESS) qrPollJob?.cancel()
                if (status == QR_SUCCESS) {
                    qrCloseJob?.cancel()
                    qrCloseJob = viewModelScope.launch {
                        delay(1_000)
                        closeQrLogin()
                    }
                }
            }
            Events.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT -> {
                val value = data as? JSONObject ?: return
                val success = value.optBoolean("success")
                _state.value = _state.value.copy(
                    platformHub = _state.value.platformHub.copy(claimingKugouConceptVip = false),
                    notice = UiNotice(
                        text = value.optString("message", if (success) "权益领取成功" else "权益领取失败"),
                        isError = !success,
                    ),
                )
            }
            Events.AUTH_SET_COOKIE_RESULT -> {
                val value = data as? JSONObject ?: return
                val platform = value.stringOrNull("platform")
                val success = value.optBoolean("success")
                val reason = value.stringOrNull("reason")
                val automatic = platform != null && autoRestoringPlatforms.remove(platform)
                if (!success && platform == null) autoRestoringPlatforms.clear()
                if (success && platform != null) {
                    value.stringOrNull("cookie")?.let {
                        appPreferences.storePlatformCookie(
                            serverUrl = activeServer?.displayUrl.orEmpty(),
                            platform = platform,
                            cookie = it,
                        )
                    }
                    loadedPlaylistPlatforms.remove(platform)
                    socket.emit(Events.AUTH_GET_STATUS)
                }
                if (shouldRemoveStoredPlatformCredential(success, platform, reason)) {
                    appPreferences.removePlatformCookie(activeServer?.displayUrl.orEmpty(), requireNotNull(platform))
                    loadedPlaylistPlatforms.remove(platform)
                    val hub = _state.value.platformHub
                    _state.value = _state.value.copy(
                        platformHub = hub.copy(
                            myAuth = hub.myAuth.filterNot { it.platform == platform },
                            playlists = hub.playlists + (platform to emptyList()),
                        ),
                    )
                }
                val message = if (shouldRemoveStoredPlatformCredential(success, platform, reason)) {
                    "QQ 音乐登录已失效，请重新扫码登录"
                } else {
                    value.optString("message", if (success) "登录成功" else "登录失败")
                }
                AppLogger.info(
                    "Auth",
                    "cookie result platform=${platform.orEmpty()} success=$success automatic=$automatic reason=${reason.orEmpty()}",
                )
                if (!automatic || !success) setNotice(message, isError = !success)
            }
            Events.AUTH_STATUS_UPDATE -> {
                val array = data as? JSONArray ?: JSONArray()
                val statuses = List(array.length()) { array.getJSONObject(it).toPlatformAuthStatus() }
                _state.value = _state.value.copy(
                    platformHub = _state.value.platformHub.copy(authStatus = statuses),
                )
            }
            Events.AUTH_MY_STATUS -> {
                val array = data as? JSONArray ?: JSONArray()
                val myAuth = List(array.length()) { array.getJSONObject(it).toMyPlatformAuth() }
                _state.value = _state.value.copy(
                    platformHub = _state.value.platformHub.copy(myAuth = myAuth, statusLoaded = true),
                )
                myAuth.filter { it.loggedIn }.forEach { auth ->
                    if (
                        auth.platform !in loadedPlaylistPlatforms &&
                        auth.platform !in _state.value.platformHub.playlistsLoading
                    ) fetchMyPlaylists(auth.platform)
                }
            }
            Events.PLAYLIST_MY_LIST -> {
                val value = data as? JSONObject ?: return
                val platform = value.optString("platform")
                if (platform !in supportedPlatforms) return
                val array = value.optJSONArray("playlists") ?: JSONArray()
                val playlists = List(array.length()) { array.getJSONObject(it).toPlaylist() }
                loadedPlaylistPlatforms += platform
                val hub = _state.value.platformHub
                _state.value = _state.value.copy(
                    platformHub = hub.copy(
                        playlists = hub.playlists + (platform to playlists),
                        playlistsLoading = hub.playlistsLoading - platform,
                    ),
                )
                AppLogger.info("Playlist", "my list platform=$platform count=${playlists.size}")
            }
            Events.NTP_PONG -> {
                val value = data as? JSONObject ?: return
                val rtt = clock.processPong(value.optLong("clientPingId"), value.optLong("serverTime")) ?: return
                lastRtt = rtt
                _state.value = _state.value.copy(pingMs = clock.medianRtt)
                if (clock.calibrated) AppLogger.debug("Sync", "NTP calibrated rttMs=${lastRtt ?: -1}")
            }
        }
    }

    private fun emitJoin(roomId: String, password: String) {
        val rejoin = appPreferences.roomRejoin(activeServer?.displayUrl.orEmpty(), roomId)
        val token = rejoin.token
        val expires = rejoin.expiresAt
        if (_state.value.room?.id != roomId) {
            _state.value = _state.value.copy(
                messages = emptyList(),
                chatUnreadCount = 0,
                activeVote = null,
            )
        }
        waitingForJoinRoomState = true
        AppLogger.info(
            "Room",
            "join request room=$roomId socketServer=$socketServerUrl activeServer=${activeServer?.displayUrl}",
        )
        val sent = socket.emit(Events.ROOM_JOIN, JSONObject().apply {
            put("roomId", roomId)
            put("nickname", _state.value.nickname.trim())
            if (password.isNotBlank()) put("password", password)
            if (!token.isNullOrBlank() && expires > System.currentTimeMillis()) put("rejoinToken", token)
        })
        if (!sent) {
            waitingForJoinRoomState = false
            setError("服务器连接尚未就绪")
        }
    }

    private fun restorePlatformAccounts(roomId: String) {
        if (restoredAuthRoomId == roomId) return
        restoredAuthRoomId = roomId
        autoRestoringPlatforms.clear()
        loadedPlaylistPlatforms.clear()
        _state.value = _state.value.copy(
            platformHub = PlatformHubState(statusLoaded = false),
        )
        supportedPlatforms.forEach { platform ->
            val cookie = appPreferences.platformCookie(
                serverUrl = activeServer?.displayUrl.orEmpty(),
                platform = platform,
            ) ?: return@forEach
            autoRestoringPlatforms += platform
            socket.emit(
                Events.AUTH_SET_COOKIE,
                JSONObject().put("platform", platform).put("cookie", cookie),
            )
        }
        socket.emit(Events.AUTH_GET_STATUS)
        AppLogger.info("Auth", "restore room=$roomId accounts=${autoRestoringPlatforms.size}")
    }

    private fun startQrPolling(platform: String, key: String) {
        qrPollJob?.cancel()
        qrPollJob = viewModelScope.launch {
            while (isActive) {
                val qr = _state.value.platformHub.qr
                if (!qr.open || qr.platform != platform || qr.key != key) break
                if (qr.status == QR_EXPIRED || qr.status == QR_SUCCESS) break
                socket.emit(
                    Events.AUTH_CHECK_QR,
                    JSONObject().put("key", key).put("platform", platform),
                )
                delay(2_000)
            }
        }
    }

    private fun requestPlaylistPage(
        server: ServerAddress,
        playlist: Playlist,
        roomId: String,
        offset: Int,
        append: Boolean,
    ) {
        val expected = PlaylistContext(playlist.source, playlist.id, roomId)
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                playlistLoading = !append,
                playlistLoadingMore = append,
                playlistError = null,
            ),
        )
        AppLogger.info("Playlist", "load source=${playlist.source} id=${playlist.id} offset=$offset")
        playlistJob = viewModelScope.launch {
            runCatching {
                api.playlist(
                    server = server,
                    source = playlist.source,
                    id = playlist.id,
                    roomId = roomId,
                    offset = offset,
                    total = playlist.trackCount.takeIf { it > 0 },
                )
            }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { page ->
                    if (playlistContext != expected) return@onSuccess
                    val old = if (append) _state.value.platformHub.playlistTracks else emptyList()
                    val merged = (old + page.tracks).distinctBy { it.id }
                    _state.value = _state.value.copy(
                        platformHub = _state.value.platformHub.copy(
                            playlistTracks = merged,
                            playlistTotal = page.total,
                            playlistHasMore = page.hasMore,
                            playlistLoading = false,
                            playlistLoadingMore = false,
                            playlistError = null,
                        ),
                    )
                    AppLogger.info(
                        "Playlist",
                        "loaded source=${playlist.source} page=${page.tracks.size} total=${page.total} hasMore=${page.hasMore}",
                    )
                }
                .onFailure {
                    if (playlistContext != expected) return@onFailure
                    AppLogger.error("Playlist", "load failed source=${playlist.source} offset=$offset", it)
                    _state.value = _state.value.copy(
                        platformHub = _state.value.platformHub.copy(
                            playlistLoading = false,
                            playlistLoadingMore = false,
                            playlistError = it.message ?: "歌单加载失败",
                        ),
                    )
                }
        }
    }

    private fun resetPlatformRoomState() {
        qrPollJob?.cancel()
        qrCloseJob?.cancel()
        playlistJob?.cancel()
        playlistAddAllJob?.cancel()
        recommendationsJob?.cancel()
        downloadOptionsJob?.cancel()
        musicDownloadJob?.cancel()
        playlistContext = null
        restoredAuthRoomId = null
        autoRestoringPlatforms.clear()
        loadedPlaylistPlatforms.clear()
        _state.value = _state.value.copy(
            platformHub = PlatformHubState(),
            recommendations = emptyList(),
            recommendationsLoading = false,
            recommendationsLoadingMore = false,
            recommendationsLoaded = false,
            recommendationsError = null,
            musicDownload = MusicDownloadState(),
        )
    }

    private fun handleCurrentTrackChanged(trackId: String?) {
        val downloadTrackId = _state.value.musicDownload.trackId ?: return
        if (downloadTrackId == trackId) return
        downloadOptionsJob?.cancel()
        musicDownloadJob?.cancel()
        downloadOptionsJob = null
        musicDownloadJob = null
        _state.value = _state.value.copy(musicDownload = MusicDownloadState())
    }

    private fun musicDownloadErrorMessage(error: Throwable): String = when {
        error is ApiException && error.statusCode == 404 && !error.message.orEmpty().contains("切换") ->
            "当前服务端不支持音乐下载"
        error is ApiException && error.statusCode == 409 -> "当前歌曲已切换，请重新打开下载"
        else -> error.message ?: "音乐下载失败，请重试"
    }

    private fun setNotice(message: String, isError: Boolean = false) {
        _state.value = _state.value.copy(notice = UiNotice(text = message, isError = isError))
    }

    private fun playModeDescription(mode: String): String = when (mode) {
        "sequential" -> "顺序播放，播完队列后停止"
        "loop-all" -> "列表循环，播完队列后从头开始"
        "loop-one" -> "单曲循环，重复播放当前歌曲"
        "shuffle" -> "随机播放，随机选择下一首歌曲"
        else -> "未知播放模式"
    }

    private fun platformLabel(platform: String): String = when (platform) {
        "netease" -> "网易云音乐"
        "tencent" -> "QQ 音乐"
        "kugou" -> "酷狗音乐"
        "kugou_concept" -> "酷狗概念版"
        "bilibili" -> "哔哩哔哩"
        else -> platform
    }

    private fun requestSearchPage(keyword: String, source: String, page: Int, append: Boolean) {
        val server = activeServer ?: run {
            _state.value = _state.value.copy(
                searchLoading = false,
                searchLoadingMore = false,
                searchError = "尚未连接服务端",
            )
            return
        }
        _state.value = _state.value.copy(
            searchLoading = !append,
            searchLoadingMore = append,
            searchError = null,
        )
        AppLogger.info("Search", "start source=$source page=$page keywordLength=${keyword.length}")
        searchJob = viewModelScope.launch {
            runCatching { api.search(server, keyword, source, _state.value.room?.id, page) }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { result ->
                    val oldTracks = if (append) _state.value.searchResults else emptyList()
                    val merged = (oldTracks + result.tracks).distinctBy { it.id }
                    AppLogger.info(
                        "Search",
                        "complete source=$source page=${result.page} pageResults=${result.tracks.size} total=${merged.size} hasMore=${result.hasMore}",
                    )
                    _state.value = _state.value.copy(
                        searchResults = merged,
                        searchLoading = false,
                        searchLoadingMore = false,
                        searchHasMore = result.hasMore,
                        searchPage = result.page,
                        searchError = null,
                    )
                }
                .onFailure {
                    val message = it.message ?: "搜索失败"
                    AppLogger.error("Search", "failed source=$source page=$page", it)
                    _state.value = _state.value.copy(
                        searchLoading = false,
                        searchLoadingMore = false,
                        searchHasMore = false,
                        searchError = message,
                        searchResults = if (append) _state.value.searchResults else emptyList(),
                    )
                }
        }
    }

    private fun beginBilibiliCollectionMatch(track: Track, pinned: Boolean, queueTrackId: String? = null) {
        val server = activeServer
        if (server == null || track.urlId.isBlank()) {
            beginBilibiliMetadataMatch(track, pinned, queueTrackId)
            return
        }
        bilibiliCollectionJob?.cancel()
        val pending = BilibiliCollectionState(
            track = track,
            pinned = pinned,
            queueTrackId = queueTrackId,
            loading = true,
        )
        _state.value = _state.value.copy(bilibiliCollection = pending)
        bilibiliCollectionJob = viewModelScope.launch {
            runCatching { api.bilibiliCollection(server, track.urlId) }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { result ->
                    val current = _state.value.bilibiliCollection
                    if (current.track?.id != track.id || current.pinned != pinned) return@onSuccess
                    if (result.tracks.size <= 1) {
                        _state.value = _state.value.copy(bilibiliCollection = BilibiliCollectionState())
                        beginBilibiliMetadataMatch(track, pinned, queueTrackId)
                    } else {
                        _state.value = _state.value.copy(
                            bilibiliCollection = pending.copy(
                                title = result.title.ifBlank { "B 站合集" },
                                tracks = result.tracks,
                                loading = false,
                            ),
                        )
                    }
                }
                .onFailure { error ->
                    val current = _state.value.bilibiliCollection
                    if (current.track?.id != track.id || current.pinned != pinned) return@onFailure
                    // Older servers do not expose the collection endpoint. Keep
                    // the existing single-video flow as a compatible fallback.
                    _state.value = _state.value.copy(bilibiliCollection = BilibiliCollectionState())
                    AppLogger.warn("Bilibili", "collection lookup failed; treating as single video: ${error.message}")
                    beginBilibiliMetadataMatch(track, pinned, queueTrackId)
                }
        }
    }

    private fun beginBilibiliMetadataMatch(track: Track, pinned: Boolean, queueTrackId: String? = null) {
        requestBilibiliMetadataSearch(
            BilibiliMetadataMatchState(
                track = track,
                pinned = pinned,
                queueTrackId = queueTrackId,
                source = "netease",
                keyword = track.title,
                loading = true,
            ),
        )
    }

    private fun requestBilibiliMetadataSearch(match: BilibiliMetadataMatchState) {
        val server = activeServer ?: return setError("尚未连接服务器")
        bilibiliMetadataSearchJob?.cancel()
        val pending = match.copy(loading = true, error = null)
        _state.value = _state.value.copy(bilibiliMetadataMatch = pending)
        bilibiliMetadataSearchJob = viewModelScope.launch {
            runCatching { api.search(server, pending.keyword, pending.source, _state.value.room?.id, page = 1) }
                .onFailure { if (it is CancellationException) throw it }
                .onSuccess { result ->
                    val current = _state.value.bilibiliMetadataMatch
                    if (
                        current.track?.id != pending.track?.id ||
                        current.source != pending.source ||
                        current.keyword != pending.keyword
                    ) return@onSuccess
                    _state.value = _state.value.copy(
                        bilibiliMetadataMatch = pending.copy(results = result.tracks, loading = false),
                    )
                }
                .onFailure { error ->
                    val current = _state.value.bilibiliMetadataMatch
                    if (
                        current.track?.id != pending.track?.id ||
                        current.source != pending.source ||
                        current.keyword != pending.keyword
                    ) return@onFailure
                    _state.value = _state.value.copy(
                        bilibiliMetadataMatch = pending.copy(loading = false, error = error.message ?: "搜索失败"),
                    )
                }
        }
    }

    private fun emitBilibiliMetadataUpdate(
        trackId: String,
        metadataSource: String? = null,
        lyricId: String? = null,
        picId: String? = null,
        cover: String? = null,
        clearMetadata: Boolean = false,
    ) {
        val payload = JSONObject().put("trackId", trackId)
        if (clearMetadata) {
            payload.put("clearMetadata", true)
        } else {
            payload.put("metadataSource", metadataSource)
            lyricId?.let { payload.put("lyricId", it) }
            picId?.let { payload.put("picId", it) }
            payload.put("cover", cover.orEmpty())
        }
        val sent = socket.emit(Events.QUEUE_UPDATE_METADATA, payload)
        if (!sent) setError("歌词和封面更新失败，请检查连接")
    }

    private fun handleScheduledState(data: Any?, action: (PlayState) -> Unit) {
        val playState = (data as? JSONObject)?.optJSONObject("playState")?.toPlayState() ?: return
        updateRoom { it.copy(playState = playState) }
        if (!playState.isPlaying) _state.value = _state.value.copy(syncDriftSeconds = 0.0)
        action(playState)
    }

    private fun playbackTarget(
        track: Track,
        policy: AudioProxyPolicy = _state.value.audioProxyPolicy,
    ): PlaybackTarget? = activeServer?.let {
        api.playbackTarget(it, track, _state.value.room?.id, policy)
    } ?: track.streamUrl?.let(::PlaybackTarget)

    private fun loadTrack(track: Track, playState: PlayState) {
        offlineLibrary.playbackUrlFor(track)?.let { playbackUrl ->
            AppLogger.info("Player", "load local track=${track.id} source=${track.source}")
            nativePlayer.load(track, playState, playbackUrl)
            return
        }
        val target = playbackTarget(track)
        AppLogger.info(
            "Player",
            "transport track=${track.id} mode=${if (target?.usesServerProxy == true) "proxy" else "direct"} " +
                "requiresServerProxy=${track.requiresServerProxy}",
        )
        nativePlayer.load(track, playState, target?.primaryUrl, target?.fallbackUrl)
    }

    private suspend fun resolveTrackForDownload(track: Track): Track {
        if (!track.streamUrl.isNullOrBlank()) return track
        _state.value.room?.currentTrack
            ?.takeIf { it.offlineDownloadKey() == track.offlineDownloadKey() }
            ?.takeIf { !it.streamUrl.isNullOrBlank() }
            ?.let { return it }
        val server = activeServer ?: throw IOException("尚未连接服务器")
        val bitrate = _state.value.room?.audioQuality ?: "320"
        val streamUrl = api.streamUrl(server, track, bitrate)
            ?: throw IOException("该音源需要先在房间播放后才能下载")
        return track.copy(streamUrl = streamUrl)
    }

    private fun updateOfflineLibrary(transform: (OfflineLibraryState) -> OfflineLibraryState) {
        _state.value = _state.value.copy(offlineLibrary = transform(_state.value.offlineLibrary))
    }

    private fun applyAudioProxyPolicy(policy: AudioProxyPolicy) {
        val previous = _state.value.audioProxyPolicy
        _state.value = _state.value.copy(audioProxyPolicy = policy)
        val track = _state.value.room?.currentTrack ?: return
        val becameForced =
            (track.source == "kugou" || track.source == "kugou_concept") &&
                !previous.kugouForceProxy &&
                policy.kugouForceProxy
        if (becameForced) {
            playbackTarget(track, policy)?.let { target ->
                nativePlayer.switchPlaybackUrl(track.id, target.primaryUrl)
            }
        }
    }

    private fun updateRoom(transform: (io.github.yueby.musictogether.model.RoomState) -> io.github.yueby.musictogether.model.RoomState) {
        val room = _state.value.room ?: return
        _state.value = _state.value.copy(room = transform(room))
    }

    private fun resolveRoomAvatarUrls(room: io.github.yueby.musictogether.model.RoomState) = room.copy(
        users = room.users.map(::resolveUserAvatarUrl),
        members = room.members.map { member ->
            member.copy(avatarUrl = resolveAvatarUrl(member.avatarUrl))
        },
    )

    private fun resolveUserAvatarUrl(user: io.github.yueby.musictogether.model.User) = user.copy(
        avatarUrl = resolveAvatarUrl(user.avatarUrl),
    )

    private fun resolveAvatarUrl(avatarUrl: String?): String? =
        activeServer?.let { api.resolveResource(it, avatarUrl) } ?: avatarUrl

    private fun controlOrVote(event: String, voteAction: String) {
        if (canControl()) socket.emit(event) else startVote(voteAction)
    }

    private fun emitQueueOrder(queue: List<Track>, successMessage: String) {
        val sent = socket.emit(
            Events.QUEUE_REORDER,
            JSONObject().put("trackIds", JSONArray(queue.map { it.id })),
        )
        AppLogger.info("Queue", "reorder sent=$sent size=${queue.size}")
        _state.value = _state.value.copy(
            notice = UiNotice(
                text = if (sent) successMessage else "队列排序发送失败，请检查连接",
                isError = !sent,
            ),
        )
    }

    private fun emitSearchQueueAction(track: Track, pinned: Boolean) {
        if (rejectDuplicateQueueTrack(track)) return
        val event = if (pinned) Events.QUEUE_INSERT_AFTER_CURRENT else Events.QUEUE_ADD
        val sent = socket.emit(event, JSONObject().put("track", track.toJson()))
        AppLogger.info("Queue", "search action=${if (pinned) "pin" else "add"} track=${track.id} sent=$sent")
        if (sent) {
            val key = track.queueIdentity()
            queueActions.reserve(key, track.title, pinned)
        } else {
            _state.value = _state.value.copy(
                notice = UiNotice(text = "点歌失败：消息未发送，请检查连接", isError = true),
            )
        }
    }

    private fun rejectDuplicateQueueTrack(track: Track): Boolean {
        val key = track.queueIdentity()
        val duplicate = queueActions.contains(key) ||
            _state.value.room?.queue.orEmpty().any { it.queueIdentity() == key }
        if (duplicate) setNotice("《${track.title}》已在播放列表中")
        return duplicate
    }

    private fun startVote(
        action: String,
        payload: JSONObject? = null,
        successDescription: String = voteActionLabel(action),
    ) {
        val sent = socket.emit(Events.VOTE_START, JSONObject().apply {
            put("action", action)
            payload?.let { put("payload", it) }
        })
        AppLogger.info("Vote", "start action=$action sent=$sent")
        _state.value = _state.value.copy(
            notice = UiNotice(
                text = if (sent) "已发起投票：$successDescription" else "投票发送失败，请检查连接",
                isError = !sent,
            ),
        )
    }

    private fun loadLyrics(track: Track) {
        lyricJob?.cancel()
        _state.value = _state.value.copy(lyrics = LyricsState(trackId = track.id, loading = true))
        val server = activeServer
        if (server == null) {
            _state.value = _state.value.copy(
                lyrics = LyricsState(trackId = track.id, error = "尚未连接服务端"),
            )
            return
        }
        lyricJob = viewModelScope.launch {
            AppLogger.info("Lyrics", "load track=${track.id} source=${track.source}")
            val ttmlLines = runCatching { api.ttml(track) }
                .onFailure {
                    if (it is CancellationException) throw it
                    AppLogger.warn("Lyrics", "TTML failed track=${track.id}: ${it.message}")
                }
                .getOrNull()
                ?.let { xml ->
                    runCatching { LyricsParser.parseTtml(xml) }
                        .onFailure { AppLogger.error("Lyrics", "TTML parse failed track=${track.id}", it) }
                        .getOrNull()
                }
                .orEmpty()

            val (lines, source, error) = if (ttmlLines.isNotEmpty()) {
                Triple(ttmlLines, "ttml", null)
            } else {
                runCatching { api.lyrics(server, track) }
                    .map { raw ->
                        if (raw == null) Triple(emptyList(), "none", "这首歌没有歌词标识")
                        else {
                            val parsed = LyricsParser.parseServerResponse(raw)
                            Triple(parsed.first, parsed.second, null)
                        }
                    }
                    .onFailure {
                        if (it is CancellationException) throw it
                        AppLogger.error("Lyrics", "server lyric failed track=${track.id}", it)
                    }
                    .getOrElse { Triple(emptyList(), "none", it.message ?: "歌词加载失败") }
            }

            if (_state.value.room?.currentTrack?.id != track.id) return@launch
            val message = error ?: if (lines.isEmpty()) "暂无歌词" else null
            AppLogger.info(
                "Lyrics",
                "loaded track=${track.id} source=$source lines=${lines.size} " +
                    "firstMs=${lines.firstOrNull()?.startTimeMs ?: -1} " +
                    "lastMs=${lines.lastOrNull()?.endTimeMs ?: -1} error=${message.orEmpty()}",
            )
            _state.value = _state.value.copy(
                lyrics = LyricsState(
                    trackId = track.id,
                    lines = lines,
                    loading = false,
                    source = source,
                    error = message,
                ),
            )
        }
    }

    private fun reconnectSocket(server: ServerAddress) {
        if (activeServer?.displayUrl != server.displayUrl) {
            AppLogger.warn(
                "WebSocket",
                "ignore stale reconnect requested=${server.displayUrl} active=${activeServer?.displayUrl}",
            )
            return
        }
        socket.disconnect()
        socketServerUrl = null
        _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Connecting)
        updateServerConnection(server.displayUrl) { it.copy(status = ConnectionStatus.Connecting, error = null) }
        connectPrimarySocket(server)
    }

    private fun emitCreateRoom(creation: PendingRoomCreation) {
        accounts.withPersistedNickname {
            AppLogger.info(
                "Room",
                "create request socketServer=$socketServerUrl activeServer=${activeServer?.displayUrl}",
            )
            val sent = socket.emit(Events.ROOM_CREATE, JSONObject().apply {
                put("nickname", _state.value.nickname.trim())
                if (creation.name.isNotBlank()) put("roomName", creation.name)
                if (creation.password.isNotBlank()) put("password", creation.password)
            })
            if (!sent) setError("服务器连接尚未就绪")
        }
    }

    private fun connectPrimarySocket(server: ServerAddress) {
        socketServerUrl = server.displayUrl
        socket.connect(server)
    }

    private fun clearIdentityBoundClientState(server: ServerAddress) {
        appPreferences.clearIdentityBoundState(server.displayUrl)
        resetPlatformRoomState()
    }

    private fun showNotice(message: String) {
        _state.value = _state.value.copy(notice = UiNotice(text = message))
    }

    private fun requireNickname(): Boolean {
        if (_state.value.nickname.trim().isNotEmpty()) return true
        setError("请先填写昵称")
        return false
    }

    private fun setError(message: String) {
        _state.value = _state.value.copy(error = message)
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect || reconnectJob?.isActive == true) return
        val attempt = reconnectBackoff.nextAttempt()
        if (attempt == null) {
            shouldReconnect = false
            val message = "连接失败，已停止自动重试，请手动重试"
            AppLogger.warn(
                "Connection",
                "automatic reconnect exhausted attempts=${reconnectBackoff.maxAttempts}",
            )
            activeServer?.displayUrl?.let { url ->
                updateServerConnection(url) {
                    it.copy(status = ConnectionStatus.Disconnected, error = message)
                }
            }
            setError(message)
            return
        }
        AppLogger.info(
            "Connection",
            "schedule reconnect attempt=${attempt.number}/${reconnectBackoff.maxAttempts} " +
                "delayMs=${attempt.delayMs}",
        )
        reconnectJob = viewModelScope.launch {
            delay(attempt.delayMs)
            if (!shouldReconnect) return@launch
            val server = activeServer ?: return@launch
            reconnectJob = null
            connectToServer(
                parsed = server,
                keepDesiredRoom = true,
                resetReconnectAttempts = false,
            )
        }
    }

    private fun startPeriodicJobs() {
        stopPeriodicJobs()
        clockJob = viewModelScope.launch {
            while (isActive) {
                sendClockPing()
                delay(
                    if (clock.calibrated) {
                        _state.value.syncPacketIntervalSeconds * 1_000L
                    } else {
                        50L
                    },
                )
            }
        }
        syncJob = viewModelScope.launch {
            while (isActive) {
                delay(_state.value.syncPacketIntervalSeconds * 1_000L)
                if (_state.value.room != null && nativePlayer.state.value.playing) {
                    socket.emit(Events.PLAYER_SYNC_REQUEST)
                }
            }
        }
    }

    private fun sendClockPing() {
        val id = clock.recordPing()
        socket.emit(Events.NTP_PING, JSONObject().apply {
            put("clientPingId", id)
            clock.medianRtt.takeIf { it > 0 }?.let { put("lastRttMs", it) }
        })
    }

    private fun stopPeriodicJobs() {
        clockJob?.cancel()
        syncJob?.cancel()
        clockJob = null
        syncJob = null
    }

    private fun onTrackEnded() {
        val room = _state.value.room
        if (room?.hostId == _state.value.userId) socket.emit(Events.PLAYER_NEXT)
    }

    override fun onCleared() {
        shouldReconnect = false
        lyricJob?.cancel()
        searchJob?.cancel()
        recommendationsJob?.cancel()
        playlistJob?.cancel()
        playlistAddAllJob?.cancel()
        downloadOptionsJob?.cancel()
        musicDownloadJob?.cancel()
        bilibiliMetadataSearchJob?.cancel()
        bilibiliCollectionJob?.cancel()
        offlineDownloadJobs.values.forEach(Job::cancel)
        PlaybackCommandBridge.listener = null
        socket.disconnect()
        socketServerUrl = null
        discovery.disconnectAll()
        nativePlayer.release()
        okHttp.dispatcher.executorService.shutdown()
        super.onCleared()
    }

    private fun voteActionLabel(action: String): String = when (action) {
        "pause" -> "暂停"
        "resume" -> "继续播放"
        "next" -> "下一首"
        "prev" -> "上一首"
        "set-mode" -> "切换播放模式"
        "play-track" -> "播放歌曲"
        "remove-track" -> "移除歌曲"
        else -> action.ifBlank { "操作" }
    }

    private fun voteReasonLabel(reason: String): String = when (reason) {
        "host_veto" -> "房主否决"
        "timeout" -> "投票超时"
        "rejected" -> "反对票过半"
        else -> "未达到通过条件"
    }
}
