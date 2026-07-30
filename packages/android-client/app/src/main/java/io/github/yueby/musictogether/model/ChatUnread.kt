package io.github.yueby.musictogether.model

internal fun nextChatUnreadCount(
    currentCount: Int,
    message: ChatMessage,
    currentUserId: String?,
    chatVisible: Boolean,
): Int {
    if (chatVisible || message.type != "user" || message.userId == currentUserId) {
        return currentCount
    }
    return (currentCount + 1).coerceAtMost(999)
}
