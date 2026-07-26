package io.github.yueby.musictogether

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.lyrics.LyricsParser
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiNotice
import io.github.yueby.musictogether.model.User
import io.github.yueby.musictogether.network.Events
import io.github.yueby.musictogether.network.MusicTogetherApi
import io.github.yueby.musictogether.network.MusicTogetherSocket
import io.github.yueby.musictogether.network.PersistentCookieJar
import io.github.yueby.musictogether.network.ServerAddress
import io.github.yueby.musictogether.network.SocketEvents
import io.github.yueby.musictogether.network.stringOrNull
import io.github.yueby.musictogether.network.toChatMessage
import io.github.yueby.musictogether.network.toPlayState
import io.github.yueby.musictogether.network.toRoomList
import io.github.yueby.musictogether.network.toRoomState
import io.github.yueby.musictogether.network.toTrack
import io.github.yueby.musictogether.network.toVoteState
import io.github.yueby.musictogether.network.toJson
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
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MusicTogetherViewModel(application: Application) : AndroidViewModel(application), SocketEvents {
    private data class PendingQueueAction(val title: String, val pinned: Boolean)

    private val preferences = application.getSharedPreferences("music_together", Context.MODE_PRIVATE)
    private val okHttp = OkHttpClient.Builder()
        .cookieJar(PersistentCookieJar(application))
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val api = MusicTogetherApi(okHttp)
    private val socket = MusicTogetherSocket(okHttp, this)
    private val clock = ClockSync()
    private val _state = MutableStateFlow(
        AppState(
            serverUrl = preferences.getString("server_url", "http://10.0.2.2:3001").orEmpty(),
            nickname = preferences.getString("nickname", "").orEmpty(),
        ),
    )
    val state: StateFlow<AppState> = _state.asStateFlow()
    private val nativePlayer = NativePlayer(application, viewModelScope, clock, ::onTrackEnded)
    val playerState: StateFlow<PlayerUiState> = nativePlayer.state

    private var activeServer: ServerAddress? = null
    private var desiredRoomId: String? = null
    private var desiredRoomPassword: String? = null
    private var shouldReconnect = false
    private var reconnectJob: Job? = null
    private var clockJob: Job? = null
    private var syncJob: Job? = null
    private var lyricJob: Job? = null
    private var searchJob: Job? = null
    private var lastRtt: Long? = null
    private var waitingForJoinRoomState = false
    private var recoveredTrackId: String? = null
    private val pendingQueueActions = linkedMapOf<String, PendingQueueAction>()

    init {
        PlaybackCommandBridge.listener = object : PlaybackCommandBridge.Listener {
            override fun onTogglePlayback() = this@MusicTogetherViewModel.togglePlayback()
            override fun onNext() = this@MusicTogetherViewModel.next()
            override fun onPrevious() = this@MusicTogetherViewModel.previous()
        }
        if (_state.value.serverUrl.isNotBlank()) connect()
    }

    fun updateServerUrl(value: String) {
        _state.value = _state.value.copy(serverUrl = value)
    }

    fun updateNickname(value: String) {
        val safe = value.take(20)
        preferences.edit().putString("nickname", safe).apply()
        _state.value = _state.value.copy(nickname = safe)
    }

    fun connect() {
        val parsed = ServerAddress.parse(_state.value.serverUrl)
        if (parsed == null) {
            setError("请输入有效的服务端 URL")
            return
        }
        AppLogger.info("Connection", "connect server=${parsed.displayUrl}")
        shouldReconnect = true
        reconnectJob?.cancel()
        socket.disconnect()
        val serverChanged = activeServer?.displayUrl != null && activeServer?.displayUrl != parsed.displayUrl
        activeServer = parsed
        if (serverChanged) {
            desiredRoomId = null
            desiredRoomPassword = null
            nativePlayer.stop()
        }
        preferences.edit().putString("server_url", parsed.displayUrl).apply()
        _state.value = _state.value.copy(
            serverUrl = parsed.displayUrl,
            connectionStatus = ConnectionStatus.Connecting,
            room = if (serverChanged) null else _state.value.room,
            error = null,
        )
        viewModelScope.launch {
            runCatching { api.bootstrapIdentity(parsed) }
                .onSuccess { userId ->
                    _state.value = _state.value.copy(userId = userId)
                    socket.connect(parsed)
                }
                .onFailure {
                    AppLogger.error("Connection", "identity bootstrap failed server=${parsed.displayUrl}", it)
                    _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Disconnected)
                    setError(it.message ?: "无法连接服务端")
                    scheduleReconnect()
                }
        }
    }

    fun disconnect() {
        shouldReconnect = false
        reconnectJob?.cancel()
        stopPeriodicJobs()
        socket.disconnect()
        _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Disconnected)
    }

    fun refreshRooms() = socket.emit(Events.ROOM_LIST)

    fun createRoom(roomName: String, password: String) {
        if (!requireNickname()) return
        socket.emit(Events.ROOM_CREATE, JSONObject().apply {
            put("nickname", _state.value.nickname.trim())
            if (roomName.isNotBlank()) put("roomName", roomName.trim().take(30))
            if (password.isNotBlank()) put("password", password.take(32))
        })
    }

    fun joinRoom(roomId: String, password: String = "") {
        if (!requireNickname()) return
        desiredRoomId = roomId
        desiredRoomPassword = password
        emitJoin(roomId, password)
    }

    fun leaveRoom() {
        socket.emit(Events.ROOM_LEAVE)
        desiredRoomId = null
        desiredRoomPassword = null
        nativePlayer.stop()
        recoveredTrackId = null
        pendingQueueActions.clear()
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

    fun castVote(approve: Boolean) = socket.emit(Events.VOTE_CAST, JSONObject().put("approve", approve))

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun clearNotice() {
        _state.value = _state.value.copy(notice = null)
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

    fun canControl(): Boolean = currentRole() in setOf("owner", "admin")

    override fun onConnected() {
        viewModelScope.launch {
            AppLogger.info("WebSocket", "connected server=${activeServer?.displayUrl}")
            reconnectJob?.cancel()
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Connected, error = null)
            socket.emit(Events.ROOM_LIST)
            desiredRoomId?.let { emitJoin(it, desiredRoomPassword.orEmpty()) }
            startPeriodicJobs()
        }
    }

    override fun onDisconnected(reason: String?) {
        viewModelScope.launch {
            AppLogger.warn("WebSocket", "disconnected reason=${reason.orEmpty()}")
            stopPeriodicJobs()
            clock.reset()
            recoveredTrackId = null
            pendingQueueActions.clear()
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Disconnected)
            if (shouldReconnect) scheduleReconnect()
        }
    }

    override fun onEvent(event: String, data: Any?) {
        viewModelScope.launch { handleEvent(event, data) }
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
            }
            Events.ROOM_STATE -> {
                val room = (data as? JSONObject)?.toRoomState() ?: return
                val isJoinSnapshot = waitingForJoinRoomState
                waitingForJoinRoomState = false
                desiredRoomId = room.id
                _state.value = _state.value.copy(room = room)
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
            Events.ROOM_LIST_UPDATE -> _state.value = _state.value.copy(rooms = (data as? JSONArray)?.toRoomList().orEmpty())
            Events.ROOM_USER_JOINED -> updateUsers { users ->
                val value = data as? JSONObject ?: return@updateUsers users
                users.filterNot { it.id == value.optString("id") } + User(
                    value.optString("id"), value.optString("nickname"), value.optString("role", "member"),
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
                waitingForJoinRoomState = false
                val message = (data as? JSONObject)?.optString("message") ?: "房间操作失败"
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
        socket.emit(Events.ROOM_JOIN, JSONObject().apply {
            put("roomId", roomId)
            put("nickname", _state.value.nickname.trim())
            if (password.isNotBlank()) put("password", password)
            if (!token.isNullOrBlank() && expires > System.currentTimeMillis()) put("rejoinToken", token)
        })
    }

    private fun rejoinKey(roomId: String): String = "rejoin:${activeServer?.displayUrl}:$roomId"

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
            if (shouldReconnect) connect()
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
