package io.github.yueby.musictogether.player

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import io.github.yueby.musictogether.settings.AppPreferences
import java.io.File

/**
 * One on-disk cache shared by playback, preloading and loudness analysis: the player reads and fills it
 * through [CacheDataSource], and analysis only downloads the spans playback has not already fetched.
 * Entries are keyed by a track identity (not the expiring stream URL).
 */
@OptIn(markerClass = [UnstableApi::class])
internal object PlaybackCache {
    @Volatile
    var enabled: Boolean = true

    private var cache: SimpleCache? = null

    /** The size limit is read once, when the cache is first opened; a later change applies after a restart. */
    @Synchronized
    fun cache(context: Context): SimpleCache = cache ?: run {
        val app = context.applicationContext
        val preferences = AppPreferences(app)
        enabled = preferences.mediaCacheEnabled()
        SimpleCache(
            File(app.cacheDir, "track-cache"),
            LeastRecentlyUsedCacheEvictor(preferences.mediaCacheLimitMb() * 1024L * 1024L),
            StandaloneDatabaseProvider(app),
        )
    }.also { cache = it }

    fun upstreamFactory(context: Context): DataSource.Factory {
        val http = DefaultHttpDataSource.Factory().setUserAgent(PlaybackRequestHeaders.USER_AGENT)
        return ResolvingDataSource.Factory(DefaultDataSource.Factory(context, http)) { dataSpec ->
            val headers = PlaybackRequestHeaders.forHost(dataSpec.uri.host.orEmpty().lowercase())
            if (headers.isNotEmpty()) dataSpec.withRequestHeaders(headers) else dataSpec
        }
    }

    /** The factory the player uses: through the cache when it is enabled, straight to the network otherwise. */
    fun playbackFactory(context: Context): DataSource.Factory {
        val upstream = upstreamFactory(context)
        val cached = cachedFactory(context, upstream)
        return DataSource.Factory { if (enabled) cached.createDataSource() else upstream.createDataSource() }
    }

    private fun cachedFactory(context: Context, upstream: DataSource.Factory) = CacheDataSource.Factory()
        .setCache(cache(context))
        .setUpstreamDataSourceFactory(upstream)
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

    fun isComplete(context: Context, key: String): Boolean {
        val cache = cache(context)
        val length = ContentMetadata.getContentLength(cache.getContentMetadata(key))
        return length != C.LENGTH_UNSET.toLong() && length > 0 && cache.isCached(key, 0, length)
    }

    fun usageBytes(context: Context): Long = cache(context).cacheSpace

    @Synchronized
    fun clear(context: Context) {
        val cache = cache(context)
        cache.keys.toList().forEach { runCatching { cache.removeResource(it) } }
    }

    /** A writer that fetches whatever of the song is not cached yet; call `cache()` on it and `cancel()` to stop. */
    fun writer(context: Context, uri: String, key: String): CacheWriter {
        val source = cachedFactory(context, upstreamFactory(context)).createDataSource()
        return CacheWriter(source, DataSpec.Builder().setUri(Uri.parse(uri)).setKey(key).build(), null, null)
    }

    /** Random-access view of a cached song for MediaExtractor; reads fall through to the network for missing spans. */
    fun mediaDataSource(context: Context, uri: String, key: String): android.media.MediaDataSource {
        val factory = cachedFactory(context, upstreamFactory(context))
        val length = ContentMetadata.getContentLength(cache(context).getContentMetadata(key))
        return object : android.media.MediaDataSource() {
            private var source: DataSource? = null
            private var position = -1L

            override fun readAt(offset: Long, buffer: ByteArray, start: Int, size: Int): Int {
                if (size == 0) return 0
                if (source == null || position != offset) {
                    source?.close()
                    val next = factory.createDataSource()
                    next.open(DataSpec.Builder().setUri(Uri.parse(uri)).setKey(key).setPosition(offset).build())
                    source = next
                    position = offset
                }
                val read = source!!.read(buffer, start, size)
                if (read > 0) position += read
                return if (read == C.RESULT_END_OF_INPUT) -1 else read
            }

            override fun getSize(): Long = length

            override fun close() {
                source?.close()
                source = null
            }
        }
    }
}
