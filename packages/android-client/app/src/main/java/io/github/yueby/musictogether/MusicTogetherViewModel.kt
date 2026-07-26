package io.github.yueby.musictogether

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.PlayState
import io.github.yueby.musictogether.model.Track
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
import io.github.yueby.musictogether.player.PlayerUiState
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
    private var lastRtt: Long? = null

    init {
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
        _state.value = _state.value.copy(room = null, messages = emptyList(), activeVote = null)
    }

    fun search(keyword: String, source: String) {
        val server = activeServer ?: return
        if (keyword.isBlank()) return
        _state.value = _state.value.copy(searchLoading = true, error = null)
        viewModelScope.launch {
            runCatching { api.search(server, keyword.trim().take(100), source, _state.value.room?.id) }
                .onSuccess { _state.value = _state.value.copy(searchResults = it, searchLoading = false) }
                .onFailure {
                    _state.value = _state.value.copy(searchLoading = false)
                    setError(it.message ?: "搜索失败")
                }
        }
    }

    fun addTrack(track: Track) = socket.emit(Events.QUEUE_ADD, JSONObject().put("track", track.toJson()))

    fun playTrack(track: Track) {
        if (!canControl()) return
        socket.emit(Events.PLAYER_PLAY, JSONObject().put("track", track.toJson()))
    }

    fun removeTrack(track: Track) {
        if (canControl()) {
            socket.emit(Events.QUEUE_REMOVE, JSONObject().put("trackId", track.id))
        } else {
            startVote("remove-track", JSONObject().put("trackId", track.id))
        }
    }

    fun clearQueue() {
        if (canControl()) socket.emit(Events.QUEUE_CLEAR)
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

    fun currentRole(): String? {
        val state = _state.value
        return state.room?.users?.firstOrNull { it.id == state.userId }?.role
    }

    fun canControl(): Boolean = currentRole() in setOf("owner", "admin")

    override fun onConnected() {
        viewModelScope.launch {
            reconnectJob?.cancel()
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Connected, error = null)
            socket.emit(Events.ROOM_LIST)
            desiredRoomId?.let { emitJoin(it, desiredRoomPassword.orEmpty()) }
            startPeriodicJobs()
        }
    }

    override fun onDisconnected(reason: String?) {
        viewModelScope.launch {
            stopPeriodicJobs()
            clock.reset()
            _state.value = _state.value.copy(connectionStatus = ConnectionStatus.Disconnected)
            if (shouldReconnect) scheduleReconnect()
        }
    }

    override fun onEvent(event: String, data: Any?) {
        viewModelScope.launch { handleEvent(event, data) }
    }

    private fun handleEvent(event: String, data: Any?) {
        when (event) {
            "connect_error" -> setError((data as? JSONObject)?.optString("message") ?: "连接认证失败")
            Events.ROOM_CREATED -> {
                val value = data as? JSONObject ?: return
                desiredRoomId = value.optString("roomId")
            }
            Events.ROOM_STATE -> {
                val room = (data as? JSONObject)?.toRoomState() ?: return
                desiredRoomId = room.id
                _state.value = _state.value.copy(room = room)
                if (room.currentTrack == null) {
                    nativePlayer.stop()
                } else {
                    room.currentTrack.takeIf { it.streamUrl != null }?.let { nativePlayer.recover(it, room.playState) }
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
            Events.ROOM_ERROR -> setError((data as? JSONObject)?.optString("message") ?: "房间操作失败")
            Events.QUEUE_UPDATED -> {
                val queueJson = (data as? JSONObject)?.optJSONArray("queue") ?: JSONArray()
                updateRoom { it.copy(queue = List(queueJson.length()) { index -> queueJson.getJSONObject(index).toTrack() }) }
            }
            Events.PLAYER_PLAY -> {
                val value = data as? JSONObject ?: return
                val track = value.optJSONObject("track")?.toTrack() ?: return
                val playState = value.optJSONObject("playState")?.toPlayState() ?: PlayState()
                updateRoom { it.copy(currentTrack = track, playState = playState) }
                nativePlayer.load(track, playState)
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
            Events.VOTE_STARTED -> _state.value = _state.value.copy(activeVote = (data as? JSONObject)?.toVoteState())
            Events.VOTE_RESULT -> _state.value = _state.value.copy(activeVote = null)
            Events.NTP_PONG -> {
                val value = data as? JSONObject ?: return
                lastRtt = clock.processPong(value.optLong("clientPingId"), value.optLong("serverTime")) ?: lastRtt
            }
        }
    }

    private fun emitJoin(roomId: String, password: String) {
        val tokenKey = rejoinKey(roomId)
        val token = preferences.getString(tokenKey, null)
        val expires = preferences.getLong("$tokenKey:expires", 0)
        socket.emit(Events.ROOM_JOIN, JSONObject().apply {
            put("roomId", roomId)
            put("nickname", _state.value.nickname.trim())
            if (password.isNotBlank()) put("password", password)
            if (!token.isNullOrBlank() && expires > System.currentTimeMillis()) put("rejoinToken", token)
        })
    }

    private fun rejoinKey(roomId: String): String = "rejoin:${activeServer?.displayUrl}:$roomId"

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

    private fun startVote(action: String, payload: JSONObject? = null) {
        socket.emit(Events.VOTE_START, JSONObject().apply {
            put("action", action)
            payload?.let { put("payload", it) }
        })
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
                delay(if (count < 20) 100 else 5_000)
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
        socket.disconnect()
        nativePlayer.release()
        okHttp.dispatcher.executorService.shutdown()
        super.onCleared()
    }
}
