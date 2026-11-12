package io.github.yueby.musictogether.player

import android.content.Context
import android.net.ConnectivityManager
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.ReplayGainMode
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.PlaybackTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext
import kotlin.math.pow
import kotlin.math.roundToLong

internal data class MediaCacheSettings(
    val enabled: Boolean = true,
    val preloadNext: Boolean = true,
    val replayGain: ReplayGainMode = ReplayGainMode.Off,
)

/** Cache identity of a track: independent of the expiring stream URL, so a replay or a preload always hits. */
internal fun trackCacheKey(track: Track, quality: String): String {
    val identity = track.lyricId ?: track.urlId.ifBlank { track.sourceId }
    val raw = "${track.source}|$identity|${track.duration.roundToLong()}|$quality"
    return MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString("") { "%02x".format(it) }
}

private class LoudnessStore(context: Context) {
    private val directory = File(context.cacheDir, "track-loudness")

    fun get(key: String): LoudnessInfo? = runCatching {
        File(directory, key).takeIf { it.isFile }?.readText()?.split(' ')
            ?.let { LoudnessInfo(it[0].toDouble(), it[1].toDouble()) }
    }.getOrNull()

    fun put(key: String, info: LoudnessInfo) {
        directory.mkdirs()
        File(directory, key).writeText("${info.lufs} ${info.peak}")
    }

    fun clear() {
        directory.listFiles()?.forEach { it.delete() }
    }
}

/**
 * Fetches the song that will come next into the shared playback cache while the current one plays, and keeps the
 * loudness-balance gain in step with each song's measured loudness. Analysis reads the same cache the player
 * fills, so a song is downloaded once.
 */
internal class MediaCacheCoordinator(
    private val context: Context,
    private val scope: CoroutineScope,
    private val settings: () -> MediaCacheSettings,
    private val quality: () -> String,
    private val nextTrack: () -> Track?,
    private val resolve: suspend (Track) -> PlaybackTarget?,
) {
    private val loudnessStore = LoudnessStore(context)
    private val preferences = context.getSharedPreferences("loudness_balance", Context.MODE_PRIVATE)
    private var job: Job? = null
    private var currentTrack: Track? = null
    private var playStartedAt = 0L
    private var appliedDb = 0.0
    private var moved = false

    fun usageBytes() = PlaybackCache.usageBytes(context)

    fun clear() {
        PlaybackCache.clear(context)
        loudnessStore.clear()
    }

    fun keyFor(track: Track): String = trackCacheKey(track, quality())

    fun onTrackLoaded(track: Track) {
        job?.cancel()
        currentTrack = track
        playStartedAt = System.currentTimeMillis()
        moved = false
        apply(gainFor(loudnessStore.get(keyFor(track))), null)
        job = scope.launch { background(track) }
    }

    fun onLocalTrack() {
        job?.cancel()
        currentTrack = null
        apply(0.0, null)
    }

    fun onSettingsChanged() {
        PlaybackCache.enabled = settings().enabled
        val track = currentTrack ?: return
        moved = false
        apply(gainFor(loudnessStore.get(keyFor(track))), null)
        job?.cancel()
        job = scope.launch { background(track) }
    }

    private suspend fun background(track: Track) {
        try {
            if (settings().replayGain != ReplayGainMode.Off) analyse(track)?.let { publish(track, it) }
            if (settings().preloadNext) {
                delay(PRELOAD_DELAY_MS)
                nextTrack()?.takeIf { it.id != track.id }?.let { analyse(it) }
            }
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            AppLogger.warn("Cache", "background task failed: ${error.message}")
        }
    }

    /** Makes sure the song is cached and measured; returns its loudness when the balance needs it. */
    private suspend fun analyse(track: Track): LoudnessInfo? {
        val current = settings()
        if (!current.enabled) return null
        val key = keyFor(track)
        val measured = loudnessStore.get(key)
        var uri: String? = null
        if (!PlaybackCache.isComplete(context, key)) {
            if (isMetered()) return null
            val target = resolve(track) ?: return null
            uri = download(key, listOfNotNull(target.primaryUrl, target.fallbackUrl)) ?: return null
        }
        if (current.replayGain == ReplayGainMode.Off) return null
        if (measured != null) return measured
        val source = uri ?: resolve(track)?.primaryUrl ?: return null
        return withContext(Dispatchers.Default) {
            val active = coroutineContext[Job]
            LoudnessAnalyzer.measure(PlaybackCache.mediaDataSource(context, source, key)) { active?.isActive != false }
        }?.also { loudnessStore.put(key, it) }
    }

    /** Returns the URL that worked. */
    @OptIn(markerClass = [UnstableApi::class])
    private suspend fun download(key: String, urls: List<String>): String? = withContext(Dispatchers.IO) {
        val job = coroutineContext[Job]!!
        for (url in urls) {
            val writer = PlaybackCache.writer(context, url, key)
            val handle = job.invokeOnCompletion { writer.cancel() }
            try {
                writer.cache()
                return@withContext url
            } catch (error: IOException) {
                if (!job.isActive) throw CancellationException("cache download cancelled")
            } finally {
                handle.dispose()
            }
        }
        null
    }

    private fun publish(track: Track, info: LoudnessInfo) {
        if (currentTrack?.id != track.id) return
        if (info.lufs > LoudnessMeter.SILENCE_LUFS) {
            saveHistory(loadHistory() + (LoudnessBalance.TARGET_LUFS - info.lufs))
        }
        val nextDb = gainFor(info)
        val playSec = (System.currentTimeMillis() - playStartedAt) / 1000.0
        when (val move = LoudnessBalance.planMove(playSec, moved, appliedDb, nextDb)) {
            LoudnessBalance.Move.Set -> apply(nextDb, null)
            is LoudnessBalance.Move.Ramp -> {
                moved = true
                apply(nextDb, move.seconds)
            }
            null -> Unit
        }
    }

    private fun gainFor(info: LoudnessInfo?): Double = when (settings().replayGain) {
        ReplayGainMode.Off -> 0.0
        ReplayGainMode.Track -> LoudnessBalance.trackGainDb(info)
        ReplayGainMode.Auto -> LoudnessBalance.autoGainDb(info, loadHistory())
    }

    private fun apply(db: Double, rampSec: Float?) {
        appliedDb = db
        PlaybackCommandBridge.setReplayGain(10.0.pow(db / 20).toFloat(), rampSec ?: LoudnessBalance.SET_RAMP_SEC)
    }

    private fun loadHistory(): List<Double> =
        preferences.getString("history", null)?.split(',')?.mapNotNull { it.toDoubleOrNull() }.orEmpty()

    private fun saveHistory(values: List<Double>) {
        preferences.edit().putString("history", values.takeLast(LoudnessBalance.TYPICAL_SIZE).joinToString(",")).apply()
    }

    private fun isMetered(): Boolean = runCatching {
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    }.getOrDefault(false)

    private companion object {
        const val PRELOAD_DELAY_MS = 8_000L
    }
}
