package io.github.yueby.musictogether.ui

import androidx.compose.material.icons.filled.Pause
import io.github.yueby.musictogether.model.Track
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

internal fun formatTime(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0) return "--:--"
    val total = seconds.roundToInt()
    return "%d:%02d".format(total / 60, total % 60)
}

internal fun formatMessageTime(timestamp: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))

internal fun roleLabel(role: String): String = when (role) {
    "owner" -> "房主"
    "admin" -> "管理员"
    else -> "成员"
}

internal fun voteActionLabel(action: String): String = when (action) {
    "pause" -> "暂停"
    "resume" -> "继续播放"
    "next" -> "下一首"
    "prev" -> "上一首"
    "set-mode" -> "切换播放模式"
    "play-track" -> "播放歌曲"
    "remove-track" -> "移除歌曲"
    else -> action
}
