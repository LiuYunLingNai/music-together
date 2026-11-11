package io.github.yueby.musictogether.model

import io.github.yueby.musictogether.network.toRoomState
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoomMembershipTest {
    private fun room() = JSONObject("""{
      "id":"room","creatorId":"owner","bannedMembers":[],
      "users":[{"id":"owner","role":"owner"},{"id":"guest","role":"member"}],
      "members":[{"id":"owner","role":"owner","isOnline":true},{"id":"offline","isOnline":false}]
    }""").toRoomState()

    @Test
    fun `online guests appear beside persistent offline members`() {
        val room = room()
        assertTrue(room.hasMemberRoster)
        assertEquals(setOf("owner", "offline", "guest"), visibleRoomMembers(room).map { it.id }.toSet())
        assertFalse(visibleRoomMembers(room).first { it.id == "offline" }.isOnline)
        assertFalse(visibleRoomMembers(room.copy(users = room.users.filterNot { it.id == "guest" })).any { it.id == "guest" })
    }

    @Test
    fun `owner may kick ordinary members but never self owner or server administrator`() {
        val room = room()
        val guest = visibleRoomMembers(room).first { it.id == "guest" }
        assertTrue(canKickRoomMember(room, "owner", guest, false))
        assertFalse(canKickRoomMember(room, "guest", guest, false))
        assertFalse(canKickRoomMember(room, "owner", guest.copy(isServerAdmin = true), false))
        assertFalse(canKickRoomMember(room, "owner", guest.copy(role = "owner"), false))
        assertFalse(canKickRoomMember(room.copy(bannedMembers = null), "owner", guest, false))
    }

    @Test
    fun `temporary room admin cannot moderate but server admin can`() {
        val room = room().copy(users = room().users.map { if (it.id == "guest") it.copy(role = "admin") else it })
        assertFalse(canModerateRoom(room, "guest", false))
        assertTrue(canModerateRoom(room, "guest", true))
        assertFalse(canModerateRoom(room, "missing", true))
    }

    @Test
    fun `ban list absence differs from supported empty list`() {
        assertNotNull(room().bannedMembers)
        assertNull(JSONObject("""{"id":"old"}""").toRoomState().bannedMembers)
        val room = JSONObject("""{"bannedMembers":[{"id":"x","nickname":"Banned","bannedAt":1000}]}""").toRoomState()
        assertEquals(RoomBan("x", "Banned", 1000), room.bannedMembers!!.single())
    }

    @Test
    fun `offline member falls back to last known client`() {
        val room = JSONObject("""{"members":[{"id":"x","isOnline":false,
          "lastClient":{"kind":"android","label":"Android"}}]}""").toRoomState()
        assertEquals("Android", room.members.single().client?.label)
    }
}
