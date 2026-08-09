package io.github.yueby.musictogether.queue

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.network.PlaylistPage
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.IOException

internal data class PlaylistQueuePlan(
    val batches: List<List<Track>>,
    val eligibleCount: Int,
    val skippedForCapacity: Int,
) {
    val tracks: List<Track> get() = batches.flatten()
}

internal fun planPlaylistQueueBatches(
    tracks: List<Track>,
    queueKeys: Set<String>,
    pendingKeys: Set<String>,
    queueSize: Int,
    maxQueueSize: Int,
    maxBatchSize: Int,
): PlaylistQueuePlan {
    require(maxQueueSize >= 0)
    require(maxBatchSize > 0)
    val distinctPendingKeys = pendingKeys - queueKeys
    val unavailable = queueKeys + distinctPendingKeys
    val eligible = tracks
        .distinctBy { it.queueIdentity() }
        .filterNot { it.queueIdentity() in unavailable }
    val available = (maxQueueSize - queueSize - distinctPendingKeys.size).coerceAtLeast(0)
    val accepted = eligible.take(available)
    return PlaylistQueuePlan(
        batches = accepted.chunked(maxBatchSize),
        eligibleCount = eligible.size,
        skippedForCapacity = eligible.size - accepted.size,
    )
}

internal suspend fun loadCompletePlaylist(
    loadPage: suspend (offset: Int) -> PlaylistPage,
    onPageLoaded: (tracks: List<Track>, total: Int, hasMore: Boolean) -> Unit = { _, _, _ -> },
): List<Track> {
    val allTracks = mutableListOf<Track>()
    var offset = 0
    var hasMore = true
    var total = 0

    while (hasMore) {
        currentCoroutineContext().ensureActive()
        val page = loadPage(offset)
        currentCoroutineContext().ensureActive()
        total = page.total.coerceAtLeast(total)
        if (page.tracks.isEmpty() && page.hasMore) {
            throw IOException("歌单分页返回空页，无法继续加载")
        }
        allTracks += page.tracks
        offset += page.tracks.size
        hasMore = page.hasMore
        onPageLoaded(allTracks.distinctBy { it.queueIdentity() }, total, hasMore)
    }

    return allTracks.distinctBy { it.queueIdentity() }
}
