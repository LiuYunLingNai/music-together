package io.github.yueby.musictogether.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

private val platformOptions = listOf(
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
    "bilibili" to "B站",
)

internal fun platformLabel(platform: String): String = when (platform) {
    "netease" -> "网易云音乐"
    "tencent" -> "QQ 音乐"
    "kugou" -> "酷狗音乐"
    "kugou_concept" -> "酷狗概念版"
    "bilibili" -> "哔哩哔哩"
    else -> platform
}

internal fun platformCollectionLabel(platform: String): String =
    if (platform == "bilibili") "收藏夹" else "歌单"

internal fun vipLabel(type: Int, providerLabel: String?): String =
    providerLabel?.trim()?.takeIf { it.isNotEmpty() } ?: when (type) {
        2 -> "SVIP"
        3 -> "超级 VIP"
        10, 11 -> "黑胶 VIP"
        else -> "VIP"
    }
