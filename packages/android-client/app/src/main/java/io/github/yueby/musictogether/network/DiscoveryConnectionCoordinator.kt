package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.ServerConnection
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject

/**
 * Owns background room-list sockets for every configured server except the
 * active room server. The primary socket remains managed by the ViewModel.
 */
internal class DiscoveryConnectionCoordinator(
    private val okHttp: OkHttpClient,
    private val api: MusicTogetherApi,
    private val scope: CoroutineScope,
    private val activeServer: () -> ServerAddress?,
    private val servers: () -> List<ServerConnection>,
    private val updateServer: (String, (ServerConnection) -> ServerConnection) -> Unit,
) {
    private val sockets = linkedMapOf<String, MusicTogetherSocket>()
    private val reconnectJobs = mutableMapOf<String, Job>()
    private val starting = mutableSetOf<String>()

    fun sync() {
        val activeUrl = activeServer()?.displayUrl
        val wanted = servers().map(ServerConnection::url).filterNot { it == activeUrl }.toSet()
        (sockets.keys - wanted).forEach(::remove)
        wanted.forEach { url ->
            if (url !in sockets && url !in starting) {
                ServerAddress.parse(url)?.let(::connect)
            }
        }
    }

    fun remove(url: String) {
        sockets.remove(url)?.disconnect()
        reconnectJobs.remove(url)?.cancel()
        starting -= url
    }

    fun refreshRooms() {
        sockets.values.forEach { it.emit(Events.ROOM_LIST) }
    }

    fun disconnectAll() {
        reconnectJobs.values.forEach(Job::cancel)
        reconnectJobs.clear()
        starting.clear()
        sockets.values.forEach(MusicTogetherSocket::disconnect)
        sockets.clear()
    }

    private fun connect(server: ServerAddress) {
        val url = server.displayUrl
        if (url == activeServer()?.displayUrl || url in starting || url in sockets) return
        starting += url
        updateServer(url) { it.copy(status = ConnectionStatus.Connecting, error = null) }
        scope.launch {
            runCatching { api.bootstrapIdentity(server) }
                .onSuccess {
                    starting -= url
                    if (url == activeServer()?.displayUrl || servers().none { it.url == url }) {
                        return@onSuccess
                    }
                    val socket = MusicTogetherSocket(okHttp, DiscoverySocketEvents(url))
                    sockets[url] = socket
                    socket.connect(server)
                }
                .onFailure { error ->
                    starting -= url
                    AppLogger.warn(
                        "Discovery",
                        "bootstrap failed server=$url reason=${error.message.orEmpty()}",
                    )
                    updateServer(url) {
                        it.copy(
                            status = ConnectionStatus.Disconnected,
                            error = error.message ?: "连接失败",
                        )
                    }
                    scheduleReconnect(url)
                }
        }
    }

    private fun scheduleReconnect(url: String) {
        if (url == activeServer()?.displayUrl || servers().none { it.url == url }) return
        reconnectJobs.remove(url)?.cancel()
        reconnectJobs[url] = scope.launch {
            delay(3_000)
            sockets.remove(url)?.disconnect()
            ServerAddress.parse(url)?.let(::connect)
        }
    }

    private inner class DiscoverySocketEvents(
        private val serverUrl: String,
    ) : SocketEvents {
        override fun onConnected() {
            scope.launch {
                reconnectJobs.remove(serverUrl)?.cancel()
                updateServer(serverUrl) {
                    it.copy(status = ConnectionStatus.Connected, error = null)
                }
                sockets[serverUrl]?.emit(Events.ROOM_LIST)
            }
        }

        override fun onDisconnected(reason: String?) {
            scope.launch {
                updateServer(serverUrl) {
                    it.copy(
                        status = ConnectionStatus.Disconnected,
                        error = reason?.takeIf(String::isNotBlank),
                    )
                }
                scheduleReconnect(serverUrl)
            }
        }

        override fun onEvent(event: String, data: Any?) {
            when (event) {
                Events.ROOM_LIST_UPDATE -> {
                    val rooms = (data as? JSONArray)?.toRoomList().orEmpty()
                    scope.launch {
                        updateServer(serverUrl) { it.copy(rooms = rooms, error = null) }
                    }
                }

                "connect_error" -> {
                    val message =
                        (data as? JSONObject)?.optString("message")?.takeIf(String::isNotBlank)
                    scope.launch {
                        updateServer(serverUrl) { it.copy(error = message ?: "连接认证失败") }
                    }
                }
            }
        }
    }
}
