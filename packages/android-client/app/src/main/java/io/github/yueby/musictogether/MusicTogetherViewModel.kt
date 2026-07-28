package io.github.yueby.musictogether

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.lyrics.LyricsParser
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.AccountProfile
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.PlatformHubState
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.QrLoginState
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.ServerConnection
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiNotice
import io.github.yueby.musictogether.model.User
import io.github.yueby.musictogether.model.UpdateDownloadSource
import io.github.yueby.musictogether.network.AppUpdateInstaller
import io.github.yueby.musictogether.network.AppUpdateService
import io.github.yueby.musictogether.network.Events
import io.github.yueby.musictogether.network.MusicTogetherApi
import io.github.yueby.musictogether.network.MusicTogetherSocket
import io.github.yueby.musictogether.network.PersistentCookieJar
import io.github.yueby.musictogether.network.ServerAddress
import io.github.yueby.musictogether.network.ServerCatalog
import io.github.yueby.musictogether.network.SocketEvents
import io.github.yueby.musictogether.network.stringOrNull
import io.github.yueby.musictogether.network.audioQuality
import io.github.yueby.musictogether.network.toChatMessage
import io.github.yueby.musictogether.network.toPlayState
import io.github.yueby.musictogether.network.toPlaylist
import io.github.yueby.musictogether.network.toPlatformAuthStatus
import io.github.yueby.musictogether.network.toMyPlatformAuth
import io.github.yueby.musictogether.network.toRoomList
import io.github.yueby.musictogether.network.toRoomState
import io.github.yueby.musictogether.network.toTrack
import io.github.yueby.musictogether.network.toVoteState
import io.github.yueby.musictogether.network.toJson
import io.github.yueby.musictogether.notifications.ChatNotificationManager
import io.github.yueby.musictogether.player.ClockSync
import io.github.yueby.musictogether.player.NativePlayer
import io.github.yueby.musictogether.player.PlaybackCommandBridge
import io.github.yueby.musictogether.player.PlayerUiState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

class MusicTogetherViewModel(application: Application) : AndroidViewModel(application), SocketEvents {
    private data class PendingQueueAction(val title: String, val pinned: Boolean)
    private data class PendingRoomCreation(val name: String, val password: String)
    private data class PlaylistContext(val source: String, val id: String, val roomId: String)

    private companion object {
        const val QR_EXPIRED = 800
        const val QR_WAITING_SCAN = 801
        const val QR_SUCCESS = 803
        const val MAX_QUEUE_SIZE = 1000
        const val MAX_QUEUE_BATCH_SIZE = 200
        val ACCOUNT_ID_PATTERN = Regex("^[a-z0-9_-]{3,32}$")
        const val MAX_AVATAR_BYTES = 5 * 1024 * 1024
        const val DEFAULT_SERVER_URL = "https://sharemusic.lyln114514.com"
        const val SERVERS_KEY = "server_urls"
        const val MAX_SERVERS = 10
        const val UPDATE_SOURCE_KEY = "update_download_source"
        const val GITHUB_RELEASES_API = "https://api.github.com/repos/LiuYunLingNai/music-together/releases"
    }

    private val preferences = application.getSharedPreferences("music_together", Context.MODE_PRIVATE)
    private val initialServerUrls = ServerCatalog.decode(
        preferences.getString(SERVERS_KEY, null),
        preferences.getString("server_url", DEFAULT_SERVER_URL).orEmpty().ifBlank { DEFAULT_SERVER_URL },
    ).ifEmpty { listOf(DEFAULT_SERVER_URL) }
    private val okHttp = OkHttpClient.Builder()
        .cookieJar(PersistentCookieJar(application))
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val api = MusicTogetherApi(okHttp)
    private val appUpdateService = AppUpdateService(okHttp)
    private val socket = MusicTogetherSocket(okHttp, this)
    private val chatNotifications = ChatNotificationManager(application)
    private val clock = ClockSync()
    private val _state = MutableStateFlow(
        AppState(
            serverUrl = initialServerUrls.first(),
            selectedServerUrl = initialServerUrls.first(),
            servers = initialServerUrls.map { ServerConnection(it) },
            nickname = preferences.getString("nickname", "").orEmpty(),
            updateSource = preferences.getString(UPDATE_SOURCE_KEY, null)
                ?.let { runCatching { UpdateDownloadSource.valueOf(it) }.getOrNull() }
                ?: UpdateDownloadSource.GitHub,
        ),
    )
    val state: StateFlow<AppState> = _state.asStateFlow()
    private val nativePlayer = NativePlayer(application, viewModelScope, clock, ::onTrackEnded)
    val playerState: StateFlow<PlayerUiState> = nativePlayer.state

    private var activeServer: ServerAddress? = null
    private var socketServerUrl: String? = null
    private val discoverySockets = linkedMapOf<String, MusicTogetherSocket>()
    private val discoveryReconnectJobs = mutableMapOf<String, Job>()
    private val discoveryStarting = mutableSetOf<String>()
    private var desiredRoomId: String? = null
    private var desiredRoomPassword: String? = null
    private var pendingRoomCreation: PendingRoomCreation? = null
    private var shouldReconnect = false
    private var reconnectJob: Job? = null
    private var clockJob: Job? = null
    private var syncJob: Job? = null
    private var lyricJob: Job? = null
    private var searchJob: Job? = null
    private var qrPollJob: Job? = null
    private var qrCloseJob: Job? = null
    private var playlistJob: Job? = null
    private var playlistContext: PlaylistContext? = null
    private var restoredAuthRoomId: String? = null
    private var appInForeground = true
    private var chatVisible = false
    private var lastRtt: Long? = null
    private var waitingForJoinRoomState = false
    private var recoveredTrackId: String? = null
    private val pendingQueueActions = linkedMapOf<String, PendingQueueAction>()
    private val autoRestoringPlatforms = mutableSetOf<String>()
    private val loadedPlaylistPlatforms = mutableSetOf<String>()
    private var downloadedUpdateApk: java.io.File? = null
    private val supportedPlatforms = listOf("netease", "tencent", "kugou")

    init {
        PlaybackCommandBridge.listener = object : PlaybackCommandBridge.Listener {
            override fun onTogglePlayback() = this@MusicTogetherViewModel.togglePlayback()
            override fun onNext() = this@MusicTogetherViewModel.next()
            override fun onPrevious() = this@MusicTogetherViewModel.previous()
        }
        checkForAppUpdate(silent = true)
        if (_state.value.serverUrl.isNotBlank()) connect()
    }

    fun updateServerUrl(value: String) {
        _state.value = _state.value.copy(serverUrl = value)
    }

    fun updateNickname(value: String) {
        val safe = value.take(40)
        preferences.edit().putString("nickname", safe).apply()
        _state.value = _state.value.copy(nickname = safe)
    }

    fun refreshAccount(showError: Boolean = true) {
        val server = activeServer ?: return
        if (_state.value.accountLoading) return
        _state.value = _state.value.copy(accountLoading = true)
        viewModelScope.launch {
            runCatching { api.currentProfile(server) }
                .onSuccess(::applyAccountProfile)
                .onFailure {
                    AppLogger.warn("Account", "profile refresh failed: ${it.message}")
                    _state.value = _state.value.copy(accountLoading = false)
                    if (showError) setError(it.message ?: "账号资料加载失败")
                }
        }
    }

    fun saveNickname() {
        val server = activeServer ?: return setError("请先连接服务端")
        val nickname = _state.value.nickname.trim()
        if (nickname.isBlank()) return setError("昵称不能为空")
        runAccountAction("昵称已保存到服务器") { api.updateNickname(server, nickname) }
    }

    fun uploadAvatar(uri: Uri) {
        val server = activeServer ?: return setError("请先连接服务端")
        if (_state.value.accountProfile == null) return setError("请先保存昵称后再上传头像")
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching {
                val resolver = getApplication<Application>().contentResolver
                val mime = resolver.getType(uri)?.lowercase()
                if (mime !in setOf("image/png", "image/jpeg", "image/jpg", "image/webp")) {
                    error("仅支持 PNG、JPEG 和 WebP 图片")
                }
                val bytes = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use(::readAvatarBytes) ?: error("无法读取图片")
                }
                val data = "data:$mime;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
                api.uploadAvatar(server, data)
            }.onSuccess {
                applyAccountProfile(it)
                showNotice("头像已保存到服务器")
            }.onFailure {
                _state.value = _state.value.copy(accountBusy = false)
                setError(it.message ?: "头像上传失败")
            }
        }
    }

    fun setInitialPassword(password: String) {
        val server = activeServer ?: return setError("请先连接服务端")
        if (password.length < 8) return setError("密码至少需要 8 个字符")
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching {
                api.setInitialPassword(server, password)
                api.currentProfile(server) ?: error("请先设置昵称")
            }.onSuccess {
                applyAccountProfile(it)
                showNotice("账号密码已设置")
            }.onFailure {
                _state.value = _state.value.copy(accountBusy = false)
                setError(it.message ?: "密码设置失败")
            }
        }
    }

    fun updateAccountId(accountId: String, currentPassword: String?) {
        val server = activeServer ?: return setError("请先连接服务端")
        val normalized = accountId.trim().lowercase()
        if (!ACCOUNT_ID_PATTERN.matches(normalized)) {
            return setError("账号 ID 需为 3-32 位小写字母、数字、下划线或连字符")
        }
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching { api.updateAccountId(server, normalized, currentPassword) }
                .onSuccess { profile ->
                    val roomId = desiredRoomId
                    roomId?.let {
                        preferences.edit().remove(rejoinKey(it)).remove("${rejoinKey(it)}:expires").apply()
                    }
                    applyAccountProfile(profile)
                    showNotice("账号 ID 已修改")
                    reconnectSocket(server)
                }
                .onFailure {
                    _state.value = _state.value.copy(accountBusy = false)
                    setError(it.message ?: "账号 ID 修改失败")
                }
        }
    }

    fun loginIdentity(accountId: String, password: String) {
        val server = activeServer ?: return setError("请先连接服务端")
        if (accountId.isBlank() || password.isBlank()) return setError("请输入账号 ID 和密码")
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching {
                api.recoverIdentity(server, accountId.trim(), password)
                api.currentProfile(server) ?: error("账号资料恢复失败")
            }.onSuccess {
                clearIdentityBoundClientState(server)
                applyAccountProfile(it)
                showNotice("账号登录成功")
                reconnectSocket(server)
            }.onFailure {
                _state.value = _state.value.copy(accountBusy = false)
                setError(it.message ?: "账号登录失败")
            }
        }
    }

    fun logoutIdentity() {
        val server = activeServer ?: return setError("请先连接服务端")
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching { api.logoutIdentity(server) }
                .onSuccess { temporaryId ->
                    desiredRoomId = null
                    desiredRoomPassword = null
                    nativePlayer.stop()
                    clearIdentityBoundClientState(server)
                    preferences.edit().remove("nickname").apply()
                    _state.value = _state.value.copy(
                        userId = temporaryId,
                        nickname = "",
                        accountProfile = null,
                        accountBusy = false,
                        room = null,
                    )
                    showNotice("已退出账号并切换到访客身份")
                    reconnectSocket(server)
                }
                .onFailure {
                    _state.value = _state.value.copy(accountBusy = false)
                    setError(it.message ?: "退出账号失败")
                }
        }
    }

    fun loadAdminData() {
        val server = activeServer ?: return setError("请先连接服务端")
        if (_state.value.accountProfile?.role != "admin") return setError("需要服务器管理员权限")
        if (_state.value.adminLoading) return
        _state.value = _state.value.copy(adminLoading = true)
        viewModelScope.launch {
            runCatching { api.adminUsers(server) to api.adminRooms(server) }
                .onSuccess { (users, rooms) ->
                    _state.value = _state.value.copy(adminUsers = users, adminRooms = rooms, adminLoading = false)
                }
                .onFailure {
                    _state.value = _state.value.copy(adminLoading = false)
                    setError(it.message ?: "管理员数据加载失败")
                }
        }
    }

    fun deleteAdminUser(userId: String) = runAdminAction(userId, "账号已删除") { server ->
        api.deleteAdminUser(server, userId)
    }

    fun resetAdminPassword(userId: String, password: String) {
        if (password.length < 8) return setError("密码至少需要 8 个字符")
        runAdminAction(userId, "密码已重置") { server -> api.resetAdminPassword(server, userId, password) }
    }

    fun dissolveAdminRoom(roomId: String) = runAdminAction(roomId, "房间已解散") { server ->
        api.dissolveAdminRoom(server, roomId)
    }

    fun updateRoomAudioQuality(quality: String) {
        val value: Any = quality.toIntOrNull() ?: quality
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("audioQuality", value))
    }

    fun updateRoomPermanent(permanent: Boolean) {
        socket.emit(Events.ROOM_SETTINGS, JSONObject().put("permanent", permanent))
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
        discoveryReconnectJobs.remove(normalized)?.cancel()
        discoveryStarting -= normalized
        discoverySockets.remove(normalized)?.disconnect()
        persistServers(remaining.map(ServerConnection::url))
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
            withPersistedNickname { emitJoin(roomId, password) }
        } else {
            connectToServer(server, keepDesiredRoom = true)
        }
    }

    private fun connectToServer(parsed: ServerAddress, keepDesiredRoom: Boolean) {
        if (_state.value.servers.none { it.url == parsed.displayUrl } && _state.value.servers.size >= MAX_SERVERS) {
            setError("最多同时连接 $MAX_SERVERS 台服务器")
            return
        }
        AppLogger.info("Connection", "connect server=${parsed.displayUrl}")
        shouldReconnect = true
        reconnectJob?.cancel()
        socket.disconnect()
        socketServerUrl = null
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
        persistServers(serverUrls)
        discoveryReconnectJobs.remove(parsed.displayUrl)?.cancel()
        discoveryStarting -= parsed.displayUrl
        discoverySockets.remove(parsed.displayUrl)?.disconnect()
        preferences.edit().putString("server_url", parsed.displayUrl).apply()
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
            error = null,
        )
        syncDiscoveryConnections()
        viewModelScope.launch {
            runCatching { api.bootstrapIdentity(parsed) }
                .onSuccess { userId ->
                    if (activeServer?.displayUrl == parsed.displayUrl) {
                        _state.value = _state.value.copy(userId = userId, accountLoading = true)
                        runCatching { api.currentProfile(parsed) }
                            .onSuccess { profile ->
                                if (activeServer?.displayUrl == parsed.displayUrl) applyAccountProfile(profile)
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
        stopPeriodicJobs()
        resetPlatformRoomState()
        socket.disconnect()
        socketServerUrl = null
        discoveryReconnectJobs.values.forEach { it.cancel() }
        discoveryReconnectJobs.clear()
        discoveryStarting.clear()
        discoverySockets.values.forEach(MusicTogetherSocket::disconnect)
        discoverySockets.clear()
        _state.value = _state.value.copy(
            connectionStatus = ConnectionStatus.Disconnected,
            servers = _state.value.servers.map { it.copy(status = ConnectionStatus.Disconnected) },
        )
    }

    fun refreshRooms() {
        socket.emit(Events.ROOM_LIST)
        discoverySockets.values.forEach { it.emit(Events.ROOM_LIST) }
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

    fun leaveRoom() {
        socket.emit(Events.ROOM_LEAVE)
        desiredRoomId = null
        desiredRoomPassword = null
        nativePlayer.stop()
        recoveredTrackId = null
        pendingQueueActions.clear()
        chatVisible = false
        chatNotifications.clear()
        resetPlatformRoomState()
        waitingForJoinRoomState = false
        _state.value = _state.value.copy(room = null, messages = emptyList(), activeVote = null)
    }

    fun search(keyword: String, source: String) {
        if (keyword.isBlank()) return
        val query = keyword.trim().take(100)
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

    fun addTrack(track: Track) {
        emitSearchQueueAction(track, pinned = false)
    }

    fun insertAfterCurrent(track: Track) {
        emitSearchQueueAction(track, pinned = true)
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
        removeStoredPlatformCookie(platform)
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
        playlistContext = PlaylistContext(playlist.source, playlist.id, room.id)
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                selectedPlaylist = playlist,
                playlistTracks = emptyList(),
                playlistTotal = 0,
                playlistHasMore = false,
                playlistLoading = true,
                playlistLoadingMore = false,
                playlistError = null,
            ),
        )
        requestPlaylistPage(server, playlist, room.id, offset = 0, append = false)
    }

    fun closePlaylist() {
        playlistJob?.cancel()
        playlistContext = null
        _state.value = _state.value.copy(
            platformHub = _state.value.platformHub.copy(
                selectedPlaylist = null,
                playlistTracks = emptyList(),
                playlistTotal = 0,
                playlistHasMore = false,
                playlistLoading = false,
                playlistLoadingMore = false,
                playlistError = null,
            ),
        )
    }

    fun loadMorePlaylistTracks() {
        val hub = _state.value.platformHub
        val playlist = hub.selectedPlaylist ?: return
        val context = playlistContext ?: return
        val server = activeServer ?: return
        if (hub.playlistLoading || hub.playlistLoadingMore || !hub.playlistHasMore) return
        requestPlaylistPage(server, playlist, context.roomId, hub.playlistTracks.size, append = true)
    }

    fun addPlaylistTracksToQueue(playlist: Playlist) {
        val room = _state.value.room ?: return
        val queueIds = room.queue.mapTo(mutableSetOf()) { it.id }
        val available = (MAX_QUEUE_SIZE - room.queue.size).coerceAtLeast(0)
        val tracks = _state.value.platformHub.playlistTracks
            .filterNot { it.id in queueIds }
            .distinctBy { it.id }
            .take(available)
        if (tracks.isEmpty()) {
            setNotice(if (available == 0) "播放队列已满" else "当前已加载歌曲都在队列中")
            return
        }
        var sent = true
        tracks.chunked(MAX_QUEUE_BATCH_SIZE).forEach { page ->
            sent = socket.emit(
                Events.QUEUE_ADD_BATCH,
                JSONObject()
                    .put("tracks", JSONArray(page.map { it.toJson() }))
                    .put("playlistName", playlist.name),
            ) && sent
        }
        AppLogger.info("Queue", "playlist batch=${tracks.size} source=${playlist.source} sent=$sent")
        setNotice(
            if (sent) "已提交 ${tracks.size} 首歌曲到播放队列" else "批量点歌发送失败，请检查连接",
            isError = !sent,
        )
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

    fun removeTrack(track: Track) {
        if (canControl()) {
            socket.emit(Events.QUEUE_REMOVE, JSONObject().put("trackId", track.id))
        } else {
            startVote(
                "remove-track",
                JSONObject().put("trackId", track.id).put("trackTitle", track.title),
            )
        }
    }

    fun clearQueue() {
        if (canControl()) socket.emit(Events.QUEUE_CLEAR)
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
        val action = if (nativePlayer.state.value.playing) "pause" else "resume"
        if (canControl()) {
            socket.emit(if (action == "pause") Events.PLAYER_PAUSE else Events.PLAYER_PLAY)
        } else {
            startVote(action)
        }
    }

    fun next() = controlOrVote(Events.PLAYER_NEXT, "next")
    fun previous() = controlOrVote(Events.PLAYER_PREV, "prev")

    fun seek(seconds: Double) {
        if (canControl()) socket.emit(Events.PLAYER_SEEK, JSONObject().put("currentTime", seconds.coerceAtLeast(0.0)))
    }

    fun setPlayMode(mode: String) {
        if (canControl()) socket.emit(Events.PLAYER_SET_MODE, JSONObject().put("mode", mode))
        else startVote("set-mode", JSONObject().put("mode", mode))
    }

    fun sendChat(content: String) {
        val safe = content.trim().take(500)
        if (safe.isNotEmpty()) socket.emit(Events.CHAT_MESSAGE, JSONObject().put("content", safe))
    }

    fun setAppForeground(foreground: Boolean) {
        appInForeground = foreground
        if (foreground && chatVisible) chatNotifications.clear()
    }

    fun setChatVisible(visible: Boolean) {
        chatVisible = visible
        if (visible) chatNotifications.clear()
    }

    fun castVote(approve: Boolean) = socket.emit(Events.VOTE_CAST, JSONObject().put("approve", approve))

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun clearNotice() {
        _state.value = _state.value.copy(notice = null)
    }

    fun selectUpdateDownloadSource(source: UpdateDownloadSource) {
        preferences.edit().putString(UPDATE_SOURCE_KEY, source.name).apply()
        _state.value = _state.value.copy(updateSource = source)
    }

    fun checkForAppUpdate(silent: Boolean = false) {
        if (_state.value.updateChecking || _state.value.updateDownloading) return
        _state.value = _state.value.copy(updateChecking = true, updateError = null)
        viewModelScope.launch {
            runCatching {
                appUpdateService.latestRelease(GITHUB_RELEASES_API, BuildConfig.VERSION_NAME)
            }.onSuccess { update ->
                val keepDownloadedApk = update?.versionName == _state.value.updateInfo?.versionName &&
                    downloadedUpdateApk?.exists() == true
                if (!keepDownloadedApk) downloadedUpdateApk = null
                _state.value = _state.value.copy(
                    updateChecking = false,
                    updateInfo = update,
                    updateReadyToInstall = keepDownloadedApk,
                    updateError = null,
                )
                if (update != null && !silent) showNotice("发现新版本 v${update.versionName}")
            }.onFailure { error ->
                AppLogger.warn("Update", "release check failed: ${error.message}")
                _state.value = _state.value.copy(
                    updateChecking = false,
                    updateError = if (silent) null else "更新检查失败，请检查网络后重试",
                )
            }
        }
    }

    fun downloadAppUpdate() {
        val update = _state.value.updateInfo ?: return
        val source = _state.value.updateSource
        if (_state.value.updateDownloading) return
        downloadedUpdateApk = null
        _state.value = _state.value.copy(
            updateDownloading = true,
            updateDownloadProgress = 0,
            updateReadyToInstall = false,
            updateError = null,
        )
        viewModelScope.launch {
            runCatching {
                appUpdateService.downloadAndVerify(getApplication<Application>(), update, source) { progress ->
                    _state.value = _state.value.copy(updateDownloadProgress = progress)
                }
            }.onSuccess { apk ->
                downloadedUpdateApk = apk
                _state.value = _state.value.copy(
                    updateDownloading = false,
                    updateDownloadProgress = 100,
                    updateReadyToInstall = true,
                )
                showNotice("更新包已下载并完成校验")
            }.onFailure { error ->
                AppLogger.warn("Update", "download failed: ${error.message}")
                _state.value = _state.value.copy(
                    updateDownloading = false,
                    updateDownloadProgress = null,
                    updateError = "更新下载或校验失败，请切换下载源后重试",
                )
            }
        }
    }

    fun installDownloadedUpdate() {
        val apk = downloadedUpdateApk?.takeIf { it.exists() } ?: run {
            _state.value = _state.value.copy(updateError = "更新包不可用，请重新下载")
            return
        }
        if (!AppUpdateInstaller.install(getApplication<Application>(), apk)) {
            showNotice("请允许本应用安装未知来源应用后，再次点击安装")
        }
    }

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

    fun canControl(): Boolean = currentRole() in setOf("owner", "admin") || _state.value.accountProfile?.role == "admin"

    private fun persistServers(urls: List<String>) {
        preferences.edit().putString(SERVERS_KEY, ServerCatalog.encode(urls)).apply()
    }

    private fun updateServerConnection(url: String, transform: (ServerConnection) -> ServerConnection) {
        val current = _state.value
        _state.value = current.copy(
            servers = current.servers.map { if (it.url == url) transform(it) else it },
        )
    }

    private fun syncDiscoveryConnections() {
        val activeUrl = activeServer?.displayUrl
        val wanted = _state.value.servers.map(ServerConnection::url).filterNot { it == activeUrl }.toSet()
        (discoverySockets.keys - wanted).forEach { url ->
            discoverySockets.remove(url)?.disconnect()
            discoveryReconnectJobs.remove(url)?.cancel()
            discoveryStarting -= url
        }
        wanted.forEach { url ->
            if (url !in discoverySockets && url !in discoveryStarting) {
                ServerAddress.parse(url)?.let(::connectDiscoveryServer)
            }
        }
    }

    private fun connectDiscoveryServer(server: ServerAddress) {
        val url = server.displayUrl
        if (url == activeServer?.displayUrl || url in discoveryStarting || url in discoverySockets) return
        discoveryStarting += url
        updateServerConnection(url) { it.copy(status = ConnectionStatus.Connecting, error = null) }
        viewModelScope.launch {
            runCatching { api.bootstrapIdentity(server) }
                .onSuccess {
                    discoveryStarting -= url
                    if (url == activeServer?.displayUrl || _state.value.servers.none { it.url == url }) return@onSuccess
                    val discoverySocket = MusicTogetherSocket(okHttp, DiscoverySocketEvents(url))
                    discoverySockets[url] = discoverySocket
                    discoverySocket.connect(server)
                }
                .onFailure { error ->
                    discoveryStarting -= url
                    AppLogger.warn("Discovery", "bootstrap failed server=$url reason=${error.message.orEmpty()}")
                    updateServerConnection(url) {
                        it.copy(status = ConnectionStatus.Disconnected, error = error.message ?: "连接失败")
                    }
                    scheduleDiscoveryReconnect(url)
                }
        }
    }

    private fun scheduleDiscoveryReconnect(url: String) {
        if (url == activeServer?.displayUrl || _state.value.servers.none { it.url == url }) return
        discoveryReconnectJobs.remove(url)?.cancel()
        discoveryReconnectJobs[url] = viewModelScope.launch {
            delay(3_000)
            discoverySockets.remove(url)?.disconnect()
            ServerAddress.parse(url)?.let(::connectDiscoveryServer)
        }
    }

    private inner class DiscoverySocketEvents(private val serverUrl: String) : SocketEvents {
        override fun onConnected() {
            viewModelScope.launch {
                discoveryReconnectJobs.remove(serverUrl)?.cancel()
                updateServerConnection(serverUrl) {
                    it.copy(status = ConnectionStatus.Connected, error = null)
                }
                discoverySockets[serverUrl]?.emit(Events.ROOM_LIST)
            }
        }

        override fun onDisconnected(reason: String?) {
            viewModelScope.launch {
                updateServerConnection(serverUrl) {
                    it.copy(status = ConnectionStatus.Disconnected, error = reason?.takeIf(String::isNotBlank))
                }
                scheduleDiscoveryReconnect(serverUrl)
            }
        }

        override fun onEvent(event: String, data: Any?) {
            if (event == Events.ROOM_LIST_UPDATE) {
                val rooms = (data as? JSONArray)?.toRoomList().orEmpty()
                viewModelScope.launch {
                    updateServerConnection(serverUrl) { it.copy(rooms = rooms, error = null) }
                }
            } else if (event == "connect_error") {
                val message = (data as? JSONObject)?.optString("message")?.takeIf(String::isNotBlank)
                viewModelScope.launch {
                    updateServerConnection(serverUrl) { it.copy(error = message ?: "连接认证失败") }
                }
            }
        }
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
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Connected, error = null)
            activeServer?.displayUrl?.let { url ->
                updateServerConnection(url) { it.copy(status = ConnectionStatus.Connected, error = null) }
            }
            socket.emit(Events.ROOM_LIST)
            val creation = pendingRoomCreation
            if (creation != null) {
                pendingRoomCreation = null
                emitCreateRoom(creation)
            } else {
                desiredRoomId?.let { emitJoin(it, desiredRoomPassword.orEmpty()) }
            }
            startPeriodicJobs()
        }
    }

    override fun onDisconnected(reason: String?) {
        val disconnectedServerUrl = socketServerUrl
        viewModelScope.launch {
            if (disconnectedServerUrl != activeServer?.displayUrl) return@launch
            AppLogger.warn("WebSocket", "disconnected reason=${reason.orEmpty()}")
            stopPeriodicJobs()
            clock.reset()
            recoveredTrackId = null
            pendingQueueActions.clear()
            resetPlatformRoomState()
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Disconnected)
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
            Events.ROOM_CREATED -> {
                val value = data as? JSONObject ?: return
                desiredRoomId = value.optString("roomId")
                value.stringOrNull("userId")?.let { userId ->
                    _state.value = _state.value.copy(userId = userId)
                }
                refreshAccount(showError = false)
            }
            Events.ROOM_STATE -> {
                val room = (data as? JSONObject)?.toRoomState() ?: return
                val isJoinSnapshot = waitingForJoinRoomState
                waitingForJoinRoomState = false
                desiredRoomId = room.id
                _state.value = _state.value.copy(room = room)
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
                        nativePlayer.load(room.currentTrack, room.playState)
                    }
                    if (_state.value.lyrics.trackId != room.currentTrack.id) loadLyrics(room.currentTrack)
                }
            }
            Events.ROOM_REJOIN_TOKEN -> {
                val value = data as? JSONObject ?: return
                val roomId = value.optString("roomId")
                val token = value.optString("token")
                val expiresAt = value.optLong("expiresAt")
                preferences.edit()
                    .putString(rejoinKey(roomId), token)
                    .putLong("${rejoinKey(roomId)}:expires", expiresAt)
                    .apply()
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
                        hasPassword = value.optBoolean("hasPassword", it.hasPassword),
                        permanent = value.optBoolean("permanent", it.permanent),
                        audioQuality = value.audioQuality("audioQuality", it.audioQuality),
                    )
                }
            }
            Events.ROOM_USER_JOINED -> updateUsers { users ->
                val value = data as? JSONObject ?: return@updateUsers users
                users.filterNot { it.id == value.optString("id") } + User(
                    value.optString("id"),
                    value.optString("nickname"),
                    value.optString("role", "member"),
                    value.stringOrNull("avatarUrl"),
                )
            }
            Events.ROOM_USER_LEFT -> updateUsers { users ->
                val id = (data as? JSONObject)?.optString("id")
                users.filterNot { it.id == id }
            }
            Events.ROOM_ROLE_CHANGED -> updateUsers { users ->
                val value = data as? JSONObject ?: return@updateUsers users
                users.map { if (it.id == value.optString("userId")) it.copy(role = value.optString("role")) else it }
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
                if (pendingQueueActions.isNotEmpty()) {
                    pendingQueueActions.clear()
                    setError("点歌失败：$message")
                } else {
                    setError(message)
                }
            }
            Events.QUEUE_UPDATED -> {
                val queueJson = (data as? JSONObject)?.optJSONArray("queue") ?: JSONArray()
                val queue = List(queueJson.length()) { index -> queueJson.getJSONObject(index).toTrack() }
                updateRoom { it.copy(queue = queue) }
                val completed = pendingQueueActions.filterKeys { id -> queue.any { it.id == id } }
                if (completed.isNotEmpty()) {
                    completed.keys.forEach(pendingQueueActions::remove)
                    val action = completed.values.last()
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
                updateRoom { it.copy(currentTrack = track, playState = playState) }
                if (_state.value.lyrics.trackId != track.id) loadLyrics(track)
                if (recoveredTrackId == track.id && nativePlayer.state.value.track?.id == track.id) {
                    AppLogger.info("Sync", "skip duplicate join PLAYER_PLAY track=${track.id}")
                    recoveredTrackId = null
                } else {
                    nativePlayer.load(track, playState)
                }
            }
            Events.PLAYER_PAUSE -> handleScheduledState(data) { nativePlayer.pause(it) }
            Events.PLAYER_RESUME -> handleScheduledState(data) { nativePlayer.resume(it) }
            Events.PLAYER_SEEK -> handleScheduledState(data) { nativePlayer.seek(it) }
            Events.PLAYER_SYNC_RESPONSE -> {
                val value = data as? JSONObject ?: return
                if (_state.value.room?.hostId == _state.value.userId) return
                val serverTimestamp = value.optLong("serverTimestamp")
                val networkDelay = ((clock.serverTime() - serverTimestamp) / 1000.0).coerceIn(0.0, 5.0)
                val expected = value.optDouble("currentTime") + if (value.optBoolean("isPlaying")) networkDelay else 0.0
                nativePlayer.correctDrift(expected, value.optBoolean("isPlaying"), (lastRtt ?: 0) + 100)
            }
            Events.CHAT_HISTORY -> {
                val array = data as? JSONArray ?: JSONArray()
                _state.value = _state.value.copy(messages = List(array.length()) { array.getJSONObject(it).toChatMessage() })
            }
            Events.CHAT_MESSAGE -> {
                val message = (data as? JSONObject)?.toChatMessage() ?: return
                _state.value = _state.value.copy(messages = (_state.value.messages + message).takeLast(200))
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
            Events.AUTH_SET_COOKIE_RESULT -> {
                val value = data as? JSONObject ?: return
                val platform = value.stringOrNull("platform")
                val success = value.optBoolean("success")
                val automatic = platform != null && autoRestoringPlatforms.remove(platform)
                if (!success && platform == null) autoRestoringPlatforms.clear()
                if (success && platform != null) {
                    value.stringOrNull("cookie")?.let { storePlatformCookie(platform, it) }
                    loadedPlaylistPlatforms.remove(platform)
                    socket.emit(Events.AUTH_GET_STATUS)
                }
                val message = value.optString("message", if (success) "登录成功" else "登录失败")
                AppLogger.info(
                    "Auth",
                    "cookie result platform=${platform.orEmpty()} success=$success automatic=$automatic reason=${value.optString("reason")}",
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
                lastRtt = clock.processPong(value.optLong("clientPingId"), value.optLong("serverTime")) ?: lastRtt
                if (clock.calibrated) AppLogger.debug("Sync", "NTP calibrated rttMs=${lastRtt ?: -1}")
            }
        }
    }

    private fun emitJoin(roomId: String, password: String) {
        val tokenKey = rejoinKey(roomId)
        val token = preferences.getString(tokenKey, null)
        val expires = preferences.getLong("$tokenKey:expires", 0)
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

    private fun rejoinKey(roomId: String): String = "rejoin:${activeServer?.displayUrl}:$roomId"

    private fun restorePlatformAccounts(roomId: String) {
        if (restoredAuthRoomId == roomId) return
        restoredAuthRoomId = roomId
        autoRestoringPlatforms.clear()
        loadedPlaylistPlatforms.clear()
        _state.value = _state.value.copy(
            platformHub = PlatformHubState(statusLoaded = false),
        )
        supportedPlatforms.forEach { platform ->
            val cookie = storedPlatformCookie(platform) ?: return@forEach
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
                delay(2_000)
                val qr = _state.value.platformHub.qr
                if (!qr.open || qr.platform != platform || qr.key != key) break
                if (qr.status == QR_EXPIRED || qr.status == QR_SUCCESS) break
                socket.emit(
                    Events.AUTH_CHECK_QR,
                    JSONObject().put("key", key).put("platform", platform),
                )
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
        playlistContext = null
        restoredAuthRoomId = null
        autoRestoringPlatforms.clear()
        loadedPlaylistPlatforms.clear()
        _state.value = _state.value.copy(platformHub = PlatformHubState())
    }

    private fun platformCookieKey(platform: String): String =
        "platform_auth:${activeServer?.displayUrl.orEmpty()}:$platform"

    private fun storedPlatformCookie(platform: String): String? =
        preferences.getString(platformCookieKey(platform), null)?.takeIf { it.isNotBlank() }

    private fun storePlatformCookie(platform: String, cookie: String) {
        preferences.edit().putString(platformCookieKey(platform), cookie).apply()
        AppLogger.info("Auth", "stored platform credential platform=$platform server=${activeServer?.displayUrl.orEmpty()}")
    }

    private fun removeStoredPlatformCookie(platform: String) {
        preferences.edit().remove(platformCookieKey(platform)).apply()
    }

    private fun setNotice(message: String, isError: Boolean = false) {
        _state.value = _state.value.copy(notice = UiNotice(text = message, isError = isError))
    }

    private fun platformLabel(platform: String): String = when (platform) {
        "netease" -> "网易云音乐"
        "tencent" -> "QQ 音乐"
        "kugou" -> "酷狗音乐"
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

    private fun handleScheduledState(data: Any?, action: (PlayState) -> Unit) {
        val playState = (data as? JSONObject)?.optJSONObject("playState")?.toPlayState() ?: return
        updateRoom { it.copy(playState = playState) }
        action(playState)
    }

    private fun updateRoom(transform: (io.github.yueby.musictogether.model.RoomState) -> io.github.yueby.musictogether.model.RoomState) {
        val room = _state.value.room ?: return
        _state.value = _state.value.copy(room = transform(room))
    }

    private fun updateUsers(transform: (List<User>) -> List<User>) = updateRoom { it.copy(users = transform(it.users)) }

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
        val event = if (pinned) Events.QUEUE_INSERT_AFTER_CURRENT else Events.QUEUE_ADD
        val sent = socket.emit(event, JSONObject().put("track", track.toJson()))
        AppLogger.info("Queue", "search action=${if (pinned) "pin" else "add"} track=${track.id} sent=$sent")
        if (sent) {
            pendingQueueActions[track.id] = PendingQueueAction(track.title, pinned)
        } else {
            _state.value = _state.value.copy(
                notice = UiNotice(text = "点歌失败：消息未发送，请检查连接", isError = true),
            )
        }
    }

    private fun startVote(action: String, payload: JSONObject? = null) {
        val sent = socket.emit(Events.VOTE_START, JSONObject().apply {
            put("action", action)
            payload?.let { put("payload", it) }
        })
        AppLogger.info("Vote", "start action=$action sent=$sent")
        _state.value = _state.value.copy(
            notice = UiNotice(
                text = if (sent) "已发起投票：${voteActionLabel(action)}" else "投票发送失败，请检查连接",
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
                    "interludes=${lines.count { it.isInterlude }} " +
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

    private fun applyAccountProfile(profile: AccountProfile?) {
        if (profile == null) {
            _state.value = _state.value.copy(accountProfile = null, accountLoading = false, accountBusy = false)
            return
        }
        val server = activeServer
        val resolved = profile.copy(avatarUrl = server?.let { api.resolveResource(it, profile.avatarUrl) } ?: profile.avatarUrl)
        preferences.edit().putString("nickname", resolved.nickname).apply()
        val previousId = _state.value.userId
        _state.value = _state.value.copy(
            userId = resolved.id,
            nickname = resolved.nickname,
            accountProfile = resolved,
            accountLoading = false,
            accountBusy = false,
            room = _state.value.room?.let { room ->
                room.copy(
                    users = room.users.map { user ->
                        if (user.id == resolved.id || user.id == previousId) {
                            user.copy(id = resolved.id, nickname = resolved.nickname, avatarUrl = resolved.avatarUrl)
                        } else {
                            user
                        }
                    },
                )
            },
        )
    }

    private fun withPersistedNickname(action: () -> Unit) {
        val server = activeServer
        val nickname = _state.value.nickname.trim()
        if (server == null || _state.value.accountProfile?.nickname == nickname) {
            action()
            return
        }
        viewModelScope.launch {
            runCatching { api.updateNickname(server, nickname) }
                .onSuccess(::applyAccountProfile)
                .onFailure { AppLogger.warn("Account", "nickname sync before room action failed: ${it.message}") }
            action()
        }
    }

    private fun runAccountAction(successMessage: String, action: suspend () -> AccountProfile) {
        if (_state.value.accountBusy) return
        _state.value = _state.value.copy(accountBusy = true)
        viewModelScope.launch {
            runCatching { action() }
                .onSuccess {
                    applyAccountProfile(it)
                    showNotice(successMessage)
                }
                .onFailure {
                    _state.value = _state.value.copy(accountBusy = false)
                    setError(it.message ?: "账号操作失败")
                }
        }
    }

    private fun runAdminAction(
        targetId: String,
        successMessage: String,
        action: suspend (ServerAddress) -> Unit,
    ) {
        val server = activeServer ?: return setError("请先连接服务端")
        if (_state.value.accountProfile?.role != "admin") return setError("需要服务器管理员权限")
        if (_state.value.adminWorkingId != null) return
        _state.value = _state.value.copy(adminWorkingId = targetId)
        viewModelScope.launch {
            runCatching { action(server) }
                .onSuccess {
                    _state.value = _state.value.copy(adminWorkingId = null)
                    showNotice(successMessage)
                    loadAdminData()
                }
                .onFailure {
                    _state.value = _state.value.copy(adminWorkingId = null)
                    setError(it.message ?: "管理员操作失败")
                }
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
        withPersistedNickname {
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
        val prefixes = listOf("platform_auth:${server.displayUrl}:", "rejoin:${server.displayUrl}:")
        val editor = preferences.edit()
        preferences.all.keys.filter { key -> prefixes.any(key::startsWith) }.forEach(editor::remove)
        editor.apply()
        resetPlatformRoomState()
    }

    private fun readAvatarBytes(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            if (output.size() > MAX_AVATAR_BYTES) error("头像不能超过 5MB")
        }
        return output.toByteArray()
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
        reconnectJob = viewModelScope.launch {
            delay(2_000)
            if (shouldReconnect) activeServer?.let { connectToServer(it, keepDesiredRoom = true) }
        }
    }

    private fun startPeriodicJobs() {
        stopPeriodicJobs()
        clockJob = viewModelScope.launch {
            var count = 0
            while (isActive) {
                val id = clock.recordPing()
                socket.emit(Events.NTP_PING, JSONObject().apply {
                    put("clientPingId", id)
                    lastRtt?.let { put("lastRttMs", it) }
                })
                count++
                delay(if (count < 20) 50 else 5_000)
            }
        }
        syncJob = viewModelScope.launch {
            while (isActive) {
                delay(2_000)
                val room = _state.value.room ?: continue
                if (room.hostId == _state.value.userId && nativePlayer.state.value.playing) {
                    socket.emit(Events.PLAYER_SYNC, JSONObject().apply {
                        put("currentTime", nativePlayer.currentPositionSeconds())
                        put("hostServerTime", clock.serverTime())
                    })
                } else if (room.hostId != _state.value.userId) {
                    socket.emit(Events.PLAYER_SYNC_REQUEST)
                }
            }
        }
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
        PlaybackCommandBridge.listener = null
        socket.disconnect()
        socketServerUrl = null
        discoveryReconnectJobs.values.forEach { it.cancel() }
        discoverySockets.values.forEach(MusicTogetherSocket::disconnect)
        discoverySockets.clear()
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
