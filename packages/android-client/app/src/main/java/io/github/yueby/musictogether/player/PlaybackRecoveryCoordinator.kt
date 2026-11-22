package io.github.yueby.musictogether.player

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeout
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
    private val resolveLocal: suspend (PlaybackRecoveryContext, Boolean) -> Track?,
    private val reloadLocal: (Track) -> Boolean,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) {
    private enum class Stage { Idle, Refresh, Reload, Fallback, Retry, Exhausted }

    private var key: PlaybackRecoveryKey? = null
    private var stage = Stage.Idle
    private var attempts = 0
    private var timer: Job? = null
    private var generation = 0L
    private var resolver: Job? = null

    fun reset() {
        resolver?.cancel()
        resolver = null
        cancelTimer()
        key = null
        stage = Stage.Idle
        attempts = 0
    }

    fun cancelPending() {
        resolver?.cancel()
        resolver = null
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
            attempts == 1 -> refresh(current, true)
            else -> {
                fail("本机刷新地址和降低音质后仍无法播放，请稍后重试")
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
        cancelTimer()
        resolver?.cancel()
        attempts++
        stage = Stage.Refresh
        val token = generation
        resolver = scope.launch {
            try {
                val track = withTimeout(8_000L) { resolveLocal(current, degrade) }
                if (token != generation || context()?.key != current.key || stage != Stage.Refresh) return@launch
                if (track == null || !matches(track) || track.streamUrl.isNullOrBlank()) {
                    fail("本机音频地址解析失败，请重试；房间继续播放")
                    return@launch
                }
                stage = Stage.Reload
                startTimer(current.key, 15_000L) { fail("本机音频加载超时，请重试；房间继续播放") }
                if (!reloadLocal(track)) fail("当前曲目已变化，本机恢复已取消")
            } catch (error: kotlinx.coroutines.TimeoutCancellationException) {
                if (token == generation && context()?.key == current.key) fail("本机音频解析超时，请重试")
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (token == generation && context()?.key == current.key) fail("本机音频解析失败，请检查网络后重试")
            }
        }
        return true
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
