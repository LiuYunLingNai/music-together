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

    @Test
    fun buildsAndParsesAppShareLink() {
        val server = ServerAddress.parse("https://music.example/app")!!
        val link = RoomShareLink.build(server, "A/B?C")
        val target = RoomJoinTargetParser.parse(link)!!

        assertEquals("A/B?C", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
        assertEquals(true, link.contains("ROMMid="))
    }

    @Test
    fun buildsAndParsesBrowserAppLink() {
        val server = ServerAddress.parse("https://music.example/app")!!
        val link = RoomShareLink.buildWeb(server, "ABC123")
        val target = RoomJoinTargetParser.parse(link)!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
        assertEquals("https://music.example/app/join?ROMMid=ABC123", link)
    }

    @Test
    fun parsesOfficialWebAppLinkWithoutServerParameter() {
        val target = RoomJoinTargetParser.parse(
            "https://sharemusic.lyln114514.com/join?ROMMid=ABC123",
        )!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://sharemusic.lyln114514.com", target.serverAddress?.displayUrl)
    }

    @Test
    fun parsesOfficialWebAppLinkWithCustomServerParameter() {
        val target = RoomJoinTargetParser.parse(
            "https://sharemusic.lyln114514.com/join?ROMMid=ABC123&server=https%3A%2F%2Fmusic.example%2Fapp",
        )!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
    }

    @Test
    fun parsesCustomServerJoinLinkWithoutOfficialDomain() {
        val target = RoomJoinTargetParser.parse(
            "https://music.example/app/join?ROMMid=ABC123",
        )!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
    }

    @Test
    fun parsesCustomServerJoinLinkWithTrailingSlash() {
        val target = RoomJoinTargetParser.parse(
            "https://music.example/app/join/?ROMMid=ABC123",
        )!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
    }

    @Test
    fun buildsAndParsesChromeIntentLink() {
        val server = ServerAddress.parse("https://music.example/app")!!
        val link = RoomShareLink.buildBrowserIntent(server, "ABC123")
        val target = RoomJoinTargetParser.parse(link)!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example/app", target.serverAddress?.displayUrl)
        assertEquals(true, link.contains("browser_fallback_url="))
        assertEquals(true, link.contains("ROMMid=ABC123"))
    }

    @Test
    fun parsesLegacyRoomHostSchemeLink() {
        val target = RoomJoinTargetParser.parse(
            "musictogether://room/ABC123?server=https%3A%2F%2Fmusic.example",
        )!!

        assertEquals("ABC123", target.roomId)
        assertEquals("https://music.example", target.serverAddress?.displayUrl)
    }

    @Test
    fun rejectsAppLinksWithoutServerOrRoom() {
        assertNull(RoomJoinTargetParser.parse("musictogether://join?room=ABC123"))
        assertNull(RoomJoinTargetParser.parse("musictogether://join?server=https%3A%2F%2Fmusic.example"))
        assertNull(RoomJoinTargetParser.parse("otherapp://join?server=https%3A%2F%2Fmusic.example&room=ABC123"))
    }
}
