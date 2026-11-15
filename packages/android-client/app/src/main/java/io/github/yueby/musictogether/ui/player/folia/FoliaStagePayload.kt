package io.github.yueby.musictogether.ui.player.folia

import io.github.yueby.musictogether.lyrics.prepareAmllLyricGroups
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.Track
import org.json.JSONArray
import org.json.JSONObject

internal enum class FoliaStageMode(val id: String, val label: String) {
    Sonnet("sonnet", "商籁"), Hanabi("hanabi", "花火"), Machi("machi", "町景"),
    Luminous("classic", "流光"), Prompt("prompt", "提示词"), Cadenza("cadenza", "心象"),
    Partita("partita", "云阶"), Fume("fume", "浮名"), Monet("monet", "莫奈"),
    Nebbia("nebbia", "雾笺"), Lumiere("lumiere", "绘光"), Diorama("diorama", "镜台"),
    Cappella("cappella", "群唱"), Claddagh("claddagh", "回环"), Pendolo("pendolo", "时计"),
    Tempera("tempera", "凝彩"), Tilt("tilt", "倾诉"), Kinetic("kinetic", "文字 PV"),
    Still("still", "静止"), Blank("blank", "纯背景"),
}

internal fun foliaLyricPositionMs(positionSeconds: Double, offsetMs: Int): Float =
    (positionSeconds * 1_000.0 - offsetMs).toFloat().coerceAtLeast(0f)

internal fun foliaLineIndex(lines: List<LyricLine>, positionMs: Float): Int =
    lines.indexOfLast { positionMs >= it.startTimeMs && positionMs < it.endTimeMs }

private fun LyricLine.foliaWords(): JSONArray = JSONArray().apply {
    words.forEach { word ->
        put(JSONObject().apply {
            put("text", word.text)
            put("startTime", word.startTimeMs / 1_000.0)
            put("endTime", word.endTimeMs / 1_000.0)
            if (word.ruby.isNotEmpty()) {
                put("syllables", JSONArray().put(JSONObject().apply {
                    put("text", word.text)
                    put("startTime", word.startTimeMs / 1_000.0)
                    put("endTime", word.endTimeMs / 1_000.0)
                    put("ruby", JSONArray().apply {
                        word.ruby.forEach { ruby -> put(JSONObject().apply {
                            put("text", ruby.text)
                            put("startTime", ruby.startTimeMs / 1_000.0)
                            put("endTime", ruby.endTimeMs / 1_000.0)
                        }) }
                    })
                }))
            }
        })
    }
}

internal fun foliaDocument(track: Track?, lyrics: LyricsState, settings: PlayerDisplaySettings): JSONObject {
    // Reject a previous track's lyrics during an automix handover or an async load.
    val groups = if (track != null && lyrics.trackId == track.id) {
        prepareAmllLyricGroups(lyrics.lines, tryAdvanceStartTime = false)
    } else emptyList()
    return JSONObject().apply {
        put("seed", track?.let { "${it.source}:${it.id}" } ?: "empty")
        put("songTitle", track?.title ?: "等待播放")
        put("songArtist", track?.artist?.joinToString(" / ") ?: "")
        put("songAlbum", track?.album ?: "")
        put("coverUrl", track?.cover?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: JSONObject.NULL)
        put("duration", track?.duration ?: 0.0)
        put("lyricsFontScale", settings.lyricFontScale)
        put("subtitleFontScale", settings.lyricSubFontScale)
        put("hideTranslationSubtitle", !settings.showTranslation)
        put("showSubtitleTranslation", settings.showTranslation)
        put("subtitleContentMode", when {
            settings.showTranslation && settings.showRomanization -> "both"
            settings.showTranslation -> "translation"
            settings.showRomanization -> "romanization"
            else -> "none"
        })
        put("subtitleOverlayLayout", when {
            settings.showTranslation && settings.showRomanization -> "romanization+translation"
            settings.showTranslation -> "translation"
            settings.showRomanization -> "romanization"
            else -> "current|only"
        })
        put("theme", JSONObject().apply {
            put("name", "Music Together")
            put("backgroundColor", "#080a0f")
            put("primaryColor", "#ffffff")
            put("secondaryColor", "#d5c9b5")
            put("accentColor", "#d1ac72")
            put("fontStyle", "sans")
            put("fontWeight", settings.lyricFontWeight)
            put("animationIntensity", "normal")
        })
        put("lines", JSONArray().apply {
            groups.forEachIndexed { index, group -> put(JSONObject().apply {
                val line = group.main
                put("id", index.toString())
                put("fullText", line.text)
                put("startTime", line.startTimeMs / 1_000.0)
                put("endTime", line.endTimeMs / 1_000.0)
                put("words", line.foliaWords())
                put("translation", if (settings.showTranslation) line.translatedLyric else "")
                put("romanization", if (settings.showRomanization) {
                    line.romanLyric.ifBlank { line.words.joinToString(" ") { it.romanText }.trim() }
                } else "")
                if (line.isDuet) put("agentId", "duet")
                group.background?.let { background ->
                    put("backgroundVocal", JSONObject().apply {
                        put("text", background.text)
                        put("startTime", background.startTimeMs / 1_000.0)
                        put("endTime", background.endTimeMs / 1_000.0)
                        put("words", background.foliaWords())
                        put("translation", if (settings.showTranslation) background.translatedLyric else "")
                    })
                }
            }) }
        })
    }
}
