package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.logging.AppLogger
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

interface SocketEvents {
    fun onConnected()
    fun onDisconnected(reason: String?)
    fun onEvent(event: String, data: Any?)
}

class MusicTogetherSocket(
    private val client: OkHttpClient,
    private val listener: SocketEvents,
) {
    private var webSocket: WebSocket? = null
    private var intentionalClose = false

    fun connect(server: ServerAddress) {
        disconnect()
        intentionalClose = false
        val request = Request.Builder().url(server.webSocketUrl).build()
        AppLogger.info("WebSocket", "opening server=${server.displayUrl}")
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (this@MusicTogetherSocket.webSocket === webSocket) listener.onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val message = JSONObject(text)
                    val event = message.optString("event")
                    val data = if (!message.has("data") || message.isNull("data")) null else message.get("data")
                    if (event.isNotBlank()) listener.onEvent(event, data)
                }.onFailure { AppLogger.error("WebSocket", "invalid incoming message", it) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                AppLogger.info("WebSocket", "closed code=$code reason=$reason intentional=$intentionalClose")
                if (this@MusicTogetherSocket.webSocket === webSocket && !intentionalClose) listener.onDisconnected(reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                AppLogger.error("WebSocket", "failure status=${response?.code ?: "none"}", t)
                if (this@MusicTogetherSocket.webSocket === webSocket && !intentionalClose) listener.onDisconnected(t.message)
            }
        })
    }

    fun emit(event: String, data: Any? = null): Boolean {
        val payload = JSONObject().put("event", event)
        if (data == null) payload.put("data", JSONObject.NULL) else payload.put("data", data)
        val sent = webSocket?.send(payload.toString()) == true
        if (event != Events.NTP_PING && event != Events.PLAYER_SYNC && event != Events.PLAYER_SYNC_REQUEST) {
            AppLogger.debug("WebSocket", "emit event=$event sent=$sent")
        }
        return sent
    }

    fun disconnect() {
        intentionalClose = true
        webSocket?.close(1000, "client disconnect")
        webSocket = null
    }
}
