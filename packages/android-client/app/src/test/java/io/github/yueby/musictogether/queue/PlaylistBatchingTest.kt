package io.github.yueby.musictogether.queue

import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.network.PlaylistPage
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistBatchingTest {
    @Test
    fun `loads every page and removes cross page duplicates`() = runBlocking {
        val offsets = mutableListOf<Int>()
        val loaded = loadCompletePlaylist(
            loadPage = { offset ->
                offsets += offset
                when (offset) {
                    0 -> PlaylistPage(listOf(track("1"), track("2")), total = 4, hasMore = true)
                    else -> PlaylistPage(listOf(track("2"), track("3")), total = 4, hasMore = false)
                }
            },
        )

        assertEquals(listOf(0, 2), offsets)
        assertEquals(listOf("1", "2", "3"), loaded.map { it.sourceId })
    }

    @Test
    fun `stops complete loading when its job is cancelled`() = runBlocking {
        var calls = 0
        val job = launch {
            loadCompletePlaylist(
                loadPage = { _ ->
                    calls += 1
                    currentCoroutineContext().cancel()
                    PlaylistPage(listOf(track("1")), total = 2, hasMore = true)
                },
            )
        }

        job.join()

        assertTrue(job.isCancelled)
        assertEquals(1, calls)
    }

    @Test
    fun `excludes queued and pending tracks then chunks to server limit`() {
        val tracks = (1..9).map { track(it.toString()) } + track("4")
        val plan = planPlaylistQueueBatches(
            tracks = tracks,
            queueKeys = setOf("netease:1"),
            pendingKeys = setOf("netease:2"),
            queueSize = 5,
            maxQueueSize = 10,
            maxBatchSize = 2,
        )

        assertEquals(listOf(2, 2), plan.batches.map { it.size })
        assertEquals(listOf("3", "4", "5", "6"), plan.tracks.map { it.sourceId })
        assertEquals(7, plan.eligibleCount)
        assertEquals(3, plan.skippedForCapacity)
    }

    private fun track(sourceId: String) = Track(
        id = sourceId,
        title = sourceId,
        artist = emptyList(),
        album = "",
        duration = 0.0,
        cover = "",
        source = "netease",
        sourceId = sourceId,
        urlId = sourceId,
    )
}
