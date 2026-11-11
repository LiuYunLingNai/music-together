package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

internal data class PlaybackRecoveryKey(
    val server: String,
    val roomId: String,
    val trackId: String,
    val source: String,
    val urlId: String,
)

internal data class PlaybackRecoveryContext(
    val key: PlaybackRecoveryKey,
    val track: Track,
    val canControl: Boolean,
)

/** One bounded recovery sequence per queue item; room changes invalidate every pending response. */
internal class PlaybackRecoveryCoordinator(
    private val scope: CoroutineScope,
    private val context: () -> PlaybackRecoveryContext?,
    private val emit: (String, JSONObject) -> Boolean,
    private val onFailure: (String) -> Unit,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) {
    private enum class Stage { Idle, Refresh, Reload, Fallback, Retry, Exhausted }

    private var key: PlaybackRecoveryKey? = null
    private var stage = Stage.Idle
    private var attempts = 0
    private var timer: Job? = null
    private var generation = 0L

    fun reset() {
        cancelTimer()
        key = null
        stage = Stage.Idle
        attempts = 0
    }

    fun cancelPending() {
        cancelTimer()
        stage = Stage.Idle
    }

    fun onMediaFailure(trackId: String, degrade: Boolean): Boolean {
        val current = context()?.takeIf { it.key.trackId == trackId } ?: return false
        if (key != current.key) reset()
        key = current.key
        if (stage in setOf(Stage.Refresh, Stage.Fallback, Stage.Retry)) return true
        return when {
            stage == Stage.Exhausted -> true
            attempts == 0 -> refresh(current, degrade)
            attempts == 1 -> fallback(current)
            else -> {
                fail("刷新地址和替代音源仍无法播放，请稍后重试或手动切歌")
                true
            }
        }
    }

    fun retry(degrade: Boolean, roomStopped: Boolean): Boolean {
        val current = context() ?: return false
        if (roomStopped && !current.canControl) return false
        if (stage in setOf(Stage.Refresh, Stage.Fallback, Stage.Retry, Stage.Reload)) return false
        reset()
        key = current.key
        if (!roomStopped) return refresh(current, degrade)
        stage = Stage.Retry
        attempts = 1
        return send(current, Events.PLAYER_RETRY_TRACK, degrade, 15_000L) {
            fail("服务端未确认重试；可能暂时不可用或不支持此功能")
        }
    }

    fun requestFallback(): Boolean {
        val current = context()?.takeIf { it.canControl } ?: return false
        if (stage in setOf(Stage.Refresh, Stage.Fallback, Stage.Retry, Stage.Reload)) return false
        reset()
        key = current.key
        return fallback(current)
    }

    fun onStreamRefreshed(track: Track): Boolean {
        val current = context() ?: return false
        if (key != current.key || stage != Stage.Refresh || !matches(track) || track.streamUrl.isNullOrBlank()) return false
        stage = Stage.Reload
        startTimer(current.key, 15_000L) { fallback(context() ?: return@startTimer) }
        return true
    }

    /** A source switch retains the queue id, but starts using a different source identity. */
    fun onSourceSwitched(current: PlaybackRecoveryContext) {
        val wasRecovering = key?.let {
            it.server == current.key.server && it.roomId == current.key.roomId &&
                it.trackId == current.key.trackId && stage == Stage.Fallback
        } == true
        reset()
        if (wasRecovering) {
            key = current.key
            attempts = 2
            stage = Stage.Reload
            startTimer(current.key, 15_000L) { fail("替代音源加载超时，请稍后重试") }
        }
    }

    fun onReady(trackId: String) {
        if (key != context()?.key || key?.trackId != trackId || stage != Stage.Reload) return
        cancelTimer()
        stage = Stage.Idle
    }

    private fun refresh(current: PlaybackRecoveryContext, degrade: Boolean): Boolean {
        attempts = 1
        stage = Stage.Refresh
        return send(current, Events.PLAYER_REFRESH_STREAM, degrade, 8_000L) {
            fallback(context() ?: return@send)
        }
    }

    private fun fallback(current: PlaybackRecoveryContext): Boolean {
        cancelTimer()
        if (!current.canControl) {
            fail("播放地址刷新失败；请稍后重试或请房主切换音源")
            return true
        }
        attempts = 2
        stage = Stage.Fallback
        return send(current, Events.PLAYER_REQUEST_SOURCE_FALLBACK, false, 15_000L) {
            // A local transport failure must not skip a song for listeners who can still play it.
            fail("替代音源未响应，请稍后重试或手动切歌")
        }
    }

    private fun send(
        current: PlaybackRecoveryContext,
        event: String,
        degrade: Boolean,
        timeoutMs: Long,
        timeout: () -> Unit,
    ): Boolean {
        val data = JSONObject().put("trackId", current.key.trackId)
        if (degrade) data.put("degrade", true)
        if (!emit(event, data)) {
            fail("请求未发送，请检查服务器连接")
            return false
        }
        startTimer(current.key, timeoutMs, timeout)
        return true
    }

    private fun matches(track: Track): Boolean = key?.let {
        it.trackId == track.id && it.source == track.source && it.urlId == track.urlId
    } == true

    private fun startTimer(expected: PlaybackRecoveryKey, timeoutMs: Long, timeout: () -> Unit) {
        cancelTimer()
        val token = generation
        timer = scope.launch {
            wait(timeoutMs)
            if (token != generation || key != expected || context()?.key != expected) return@launch
            timer = null
            timeout()
        }
    }

    private fun fail(message: String) {
        cancelTimer()
        stage = Stage.Exhausted
        onFailure(message)
    }

    private fun cancelTimer() {
        generation++
        timer?.cancel()
        timer = null
    }
}
