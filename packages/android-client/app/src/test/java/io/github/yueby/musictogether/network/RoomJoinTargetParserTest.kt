package io.github.yueby.musictogether.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomJoinTargetParserTest {
    @Test
    fun parsesPlainRoomIdAgainstCurrentServer() {
        val target = RoomJoinTargetParser.parse("  CDIBR9  ")!!

        assertEquals("CDIBR9", target.roomId)
        assertNull(target.serverAddress)
    }

    @Test
    fun parsesHttpsInviteWithCustomPort() {
        val target = RoomJoinTargetParser.parse("https://0music.qqun.top:9872/room/CDIBR9")!!

        assertEquals("CDIBR9", target.roomId)
        assertEquals("https://0music.qqun.top:9872", target.serverAddress?.displayUrl)
    }

    @Test
    fun ignoresInviteQueryFragmentAndTrailingSlash() {
        val target = RoomJoinTargetParser.parse("https://music.example/room/ABC123/?from=share#player")!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example", target.serverAddress?.displayUrl)
    }

    @Test
    fun preservesReverseProxyBasePath() {
        val target = RoomJoinTargetParser.parse("https://music.example/app/room/ABC123")!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
        assertEquals("wss://music.example/app/ws", target.serverAddress?.webSocketUrl)
        assertEquals("https://music.example/app/api/health", target.serverAddress?.api("health").toString())
    }

    @Test
    fun rejectsMalformedInviteUrls() {
        assertNull(RoomJoinTargetParser.parse("https://music.example/room/"))
        assertNull(RoomJoinTargetParser.parse("https://music.example/not-a-room/ABC123"))
        assertNull(RoomJoinTargetParser.parse("ftp://music.example/room/ABC123"))
    }
}
