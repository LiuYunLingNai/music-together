package io.github.yueby.musictogether.model

import androidx.compose.runtime.Immutable

@Immutable
data class RoomBan(val id: String, val nickname: String, val bannedAt: Long)

fun canModerateRoom(room: RoomState, userId: String?, serverAdmin: Boolean): Boolean {
    val user = room.users.firstOrNull { it.id == userId } ?: return false
    return user.role == "owner" || user.isServerAdmin || serverAdmin
}

fun canKickRoomMember(room: RoomState, userId: String?, target: RoomMember, serverAdmin: Boolean): Boolean =
    room.bannedMembers != null && canModerateRoom(room, userId, serverAdmin) &&
        target.id != userId && target.id != room.creatorId && target.role != "owner" && !target.isServerAdmin

/** Online-only guests are not part of the persistent roster supplied by newer servers. */
fun visibleRoomMembers(room: RoomState): List<RoomMember> {
    val roster = room.members.associateBy { it.id }.toMutableMap()
    room.users.forEach { user ->
        val previous = roster[user.id]
        roster[user.id] = RoomMember(
            user.id, user.nickname, user.role, user.avatarUrl, user.isServerAdmin, user.client, user.clients,
            isOnline = true, joinedAt = previous?.joinedAt ?: 0L, lastSeenAt = previous?.lastSeenAt,
        )
    }
    return roster.values.toList()
}
