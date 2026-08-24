package io.github.yueby.musictogether.share

import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track

internal data class ShareCardContent(
    val roomName: String,
    val trackTitle: String,
    val trackArtist: String,
    val trackAlbum: String,
    val durationText: String,
    val listenerText: String,
    val link: String,
    val coverUrl: String?,
) {
    companion object {
        fun from(room: RoomState, link: String): ShareCardContent {
            val track = room.currentTrack
            return ShareCardContent(
                roomName = room.name.ifBlank { "Music Together 房间" },
                trackTitle = track?.title?.takeIf(String::isNotBlank) ?: "还没有正在播放的歌曲",
                trackArtist = track?.let(::shareArtistText).orEmpty(),
                trackAlbum = track?.album?.takeIf(String::isNotBlank).orEmpty(),
                durationText = track?.duration?.let(::shareDurationText).orEmpty(),
                listenerText = shareListenerText(room.users.size),
                link = link,
                coverUrl = track?.cover?.takeIf(String::isNotBlank),
            )
        }
    }
}

internal fun shareArtistText(track: Track): String =
    track.artist.filter(String::isNotBlank).joinToString(" / ")

internal fun shareDurationText(durationSeconds: Double): String {
    if (durationSeconds.isNaN() || durationSeconds <= 0.0) return ""
    val total = durationSeconds.toLong()
    val minutes = total / 60
    val seconds = total % 60
    return "%d:%02d".format(minutes, seconds)
}

internal fun shareListenerText(userCount: Int): String =
    if (userCount <= 0) "等你一起听" else "$userCount 人正在一起听"

internal fun shareSubtitleText(content: ShareCardContent): String =
    listOf(content.trackArtist, content.trackAlbum)
        .filter(String::isNotBlank)
        .joinToString(" · ")

internal fun shareFileName(roomId: String, timestampMillis: Long): String {
    val safeRoomId = roomId.map { if (it.isLetterOrDigit()) it else '_' }.joinToString("")
    return "room_${safeRoomId.ifBlank { "share" }}_$timestampMillis.png"
}
