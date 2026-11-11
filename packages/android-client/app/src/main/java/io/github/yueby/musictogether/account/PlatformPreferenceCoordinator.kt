package io.github.yueby.musictogether.account

import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.network.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

internal class PlatformPreferenceCoordinator(
    private val scope: CoroutineScope,
    private val state: () -> AppState,
    private val updateState: ((AppState) -> AppState) -> Unit,
    private val emit: (String, JSONObject?) -> Boolean,
    private val notice: (String) -> Unit,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) {
    private data class Pending(val context: List<String?>, val value: Boolean, val job: Job)
    private val pending = mutableMapOf<String, Pending>()
    private fun context() = state().let { listOf(it.selectedServerUrl, it.room?.id, it.userId) }

    fun set(platform: String, reporting: Boolean, value: Boolean) {
        val auth = state().platformHub.myAuth.firstOrNull { it.platform == platform && it.loggedIn } ?: return
        val field = if (reporting) "reportListening" else "shareWithRoom"
        val current = if (reporting) auth.reportListening else auth.shareWithRoom
        if (current == null || current == value || (reporting && platform != "netease") || state().room == null) return
        val key = "$platform:$field"
        if (key in pending) return
        val expected = context()
        val event = if (reporting) Events.AUTH_SET_REPORTING else Events.AUTH_SET_SHARING
        if (!emit(event, JSONObject().put("platform", platform).put(field, value))) {
            notice("设置请求未发送，请检查连接")
            return
        }
        val job = scope.launch {
            wait(8_000L)
            val request = pending[key] ?: return@launch
            pending.remove(key)
            publishPending()
            if (request.context == context()) notice("服务端未确认设置，请稍后重试")
        }
        pending[key] = Pending(expected, value, job)
        publishPending()
    }

    fun onResult(reporting: Boolean, data: JSONObject) {
        val platform = data.optString("platform")
        val field = if (reporting) "reportListening" else "shareWithRoom"
        val key = "$platform:$field"
        val request = pending[key] ?: return
        if (request.context != context()) return
        if (data.optBoolean("ok") && data.opt(field) != request.value) return
        pending.remove(key)?.job?.cancel()
        publishPending()
        if (!data.optBoolean("ok")) {
            notice("设置未生效，请确认平台登录状态后重试")
            return
        }
        updateState { current ->
            current.copy(platformHub = current.platformHub.copy(myAuth = current.platformHub.myAuth.map {
                if (it.platform != platform) it
                else if (reporting) it.copy(reportListening = request.value)
                else it.copy(shareWithRoom = request.value)
            }))
        }
        emit(Events.AUTH_GET_STATUS, null)
    }

    fun cancel(platform: String? = null) {
        pending.keys.filter { platform == null || it.startsWith("$platform:") }.forEach {
            pending.remove(it)?.job?.cancel()
        }
        publishPending()
    }

    private fun publishPending() {
        updateState { it.copy(platformHub = it.platformHub.copy(pendingPreferences = pending.keys.toSet())) }
    }
}
