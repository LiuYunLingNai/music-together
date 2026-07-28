package io.github.yueby.musictogether.lyrics

import io.github.yueby.musictogether.model.Track

fun lyricOffsetKey(track: Track?): String? {
    val value = track ?: return null
    val lyricId = value.lyricId?.takeIf { it.isNotBlank() } ?: return null
    val lyricSource = value.metadataSource ?: value.source
    return if (value.source == "bilibili") {
        "bilibili:${value.urlId}:$lyricSource:$lyricId"
    } else {
        "$lyricSource:$lyricId"
    }
}
