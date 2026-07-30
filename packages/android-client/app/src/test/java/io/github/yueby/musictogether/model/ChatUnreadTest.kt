package io.github.yueby.musictogether.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatUnreadTest {
    private val message = ChatMessage(
        id = "message-1",
        userId = "other-user",
        nickname = "Other",
        content = "hello",
        timestamp = 1L,
        type = "user",
    )

    @Test
    fun closedChatCountsMessagesFromOtherUsers() {
        assertEquals(
            3,
            nextChatUnreadCount(
                currentCount = 2,
                message = message,
                currentUserId = "me",
                chatVisible = false,
            ),
        )
    }

    @Test
    fun visibleChatAndOwnMessagesDoNotIncreaseUnreadCount() {
        assertEquals(
            2,
            nextChatUnreadCount(2, message, currentUserId = "me", chatVisible = true),
        )
        assertEquals(
            2,
            nextChatUnreadCount(
                2,
                message.copy(userId = "me"),
                currentUserId = "me",
                chatVisible = false,
            ),
        )
    }

    @Test
    fun systemMessagesDoNotIncreaseUnreadCount() {
        assertEquals(
            2,
            nextChatUnreadCount(
                2,
                message.copy(type = "system"),
                currentUserId = "me",
                chatVisible = false,
            ),
        )
    }
}
