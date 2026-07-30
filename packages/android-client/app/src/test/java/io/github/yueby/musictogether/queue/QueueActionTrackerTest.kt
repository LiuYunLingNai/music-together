package io.github.yueby.musictogether.queue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueActionTrackerTest {
    @Test
    fun tracksSingleActionUntilPublishedQueueContainsIt() {
        val tracker = QueueActionTracker()

        tracker.reserve("tencent:song-1", title = "晴天", pinned = true)

        assertTrue(tracker.contains("tencent:song-1"))
        assertTrue(tracker.hasPending())
        assertEquals(
            CompletedQueueAction(title = "晴天", pinned = true),
            tracker.completePublished(setOf("tencent:song-1")),
        )
        assertFalse(tracker.contains("tencent:song-1"))
        assertFalse(tracker.hasPending())
    }

    @Test
    fun batchReservationsAffectCapacityWithoutCreatingSuccessNotice() {
        val tracker = QueueActionTracker()
        tracker.reserveAll(listOf("netease:1", "netease:2"))

        assertEquals(
            setOf("netease:2"),
            tracker.reservedKeys(excluding = setOf("netease:1")),
        )
        assertNull(tracker.completePublished(setOf("netease:1")))
        assertTrue(tracker.contains("netease:2"))
    }

    @Test
    fun clearDropsEveryPendingReservation() {
        val tracker = QueueActionTracker()
        tracker.reserve("kugou:1", title = "测试", pinned = false)
        tracker.reserveAll(listOf("kugou:2"))

        tracker.clear()

        assertFalse(tracker.hasPending())
        assertFalse(tracker.contains("kugou:1"))
        assertFalse(tracker.contains("kugou:2"))
    }
}
