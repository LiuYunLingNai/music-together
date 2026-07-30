package io.github.yueby.musictogether.queue

internal data class CompletedQueueAction(
    val title: String,
    val pinned: Boolean,
)

/**
 * Owns optimistic queue reservations until the server publishes the updated
 * queue. Keeping this state outside the ViewModel makes duplicate prevention
 * and completion handling share one lifecycle.
 */
internal class QueueActionTracker {
    private val pendingActions = linkedMapOf<String, CompletedQueueAction>()
    private val pendingTrackKeys = mutableSetOf<String>()

    fun clear() {
        pendingActions.clear()
        pendingTrackKeys.clear()
    }

    fun hasPending(): Boolean =
        pendingActions.isNotEmpty() || pendingTrackKeys.isNotEmpty()

    fun contains(trackKey: String): Boolean = trackKey in pendingTrackKeys

    fun reservedKeys(excluding: Set<String>): Set<String> =
        pendingTrackKeys - excluding

    fun reserveAll(trackKeys: Iterable<String>) {
        pendingTrackKeys.addAll(trackKeys)
    }

    fun reserve(trackKey: String, title: String, pinned: Boolean) {
        pendingTrackKeys += trackKey
        pendingActions[trackKey] = CompletedQueueAction(title, pinned)
    }

    fun completePublished(queueKeys: Set<String>): CompletedQueueAction? {
        pendingTrackKeys.removeAll(queueKeys)
        val completed = pendingActions.filterKeys { it in queueKeys }
        completed.keys.forEach(pendingActions::remove)
        return completed.values.lastOrNull()
    }
}
