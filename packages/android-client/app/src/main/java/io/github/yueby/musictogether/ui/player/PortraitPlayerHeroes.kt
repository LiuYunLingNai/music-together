package io.github.yueby.musictogether.ui.player

import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Tune
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import kotlin.math.roundToInt

@Composable
internal fun MobileLyricsHero(
    track: Track,
    lyrics: LyricsState,
    lyricOffsetMs: Int,
    player: PlayerUiState,
    chatUnreadCount: Int,
    onOpenChat: () -> Unit,
    onSeek: (Double) -> Unit,
    onSetLyricOffset: (Int) -> Unit,
    coverSlot: Modifier,
) {
    var lyricOffsetPanelVisible by remember(track.id) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(coverSlot.size(56.dp))
            SongHandoff(
                target = PortraitTrackText(
                    trackId = track.id,
                    title = track.title,
                    subtitle = track.artist.joinToString(" / "),
                ),
                modifier = Modifier.weight(1f),
            ) { label ->
                Column {
                    Text(
                        text = label.title,
                        modifier = Modifier.basicMarquee(),
                        color = Color.White.copy(alpha = 0.94f),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                    Text(
                        text = label.subtitle,
                        modifier = Modifier.basicMarquee(),
                        color = Color.White.copy(alpha = 0.56f),
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                }
            }
            LyricActionsMenu(
                unreadCount = chatUnreadCount,
                canAdjustLyricOffset = lyricOffsetKey(track) != null,
                onOpenChat = onOpenChat,
                onOpenLyricOffset = { lyricOffsetPanelVisible = true },
            )
        }
        AnimatedVisibility(visible = lyricOffsetPanelVisible) {
            LyricOffsetPanel(
                offsetMs = lyricOffsetMs,
                onDismiss = { lyricOffsetPanelVisible = false },
                onOffsetChange = onSetLyricOffset,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        Spacer(Modifier.height(if (lyricOffsetPanelVisible) 12.dp else 6.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .lyricFadeMask(),
        ) {
            LyricsPanel(
                lyrics = lyrics,
                positionSeconds = player.positionSeconds,
                lyricOffsetMs = lyricOffsetMs,
                isPlaying = player.playing,
                onSeek = { lyricTimeSeconds -> onSeek(lyricTimeSeconds + lyricOffsetMs / 1_000.0) },
                alignToTop = true,
            )
        }
    }
}

@Composable
internal fun LyricActionsMenu(
    unreadCount: Int,
    canAdjustLyricOffset: Boolean,
    onOpenChat: () -> Unit,
    onOpenLyricOffset: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(
            onClick = { expanded = true },
            modifier = Modifier.size(40.dp),
        ) {
            Icon(
                Icons.Default.MoreVert,
                contentDescription = "更多",
                tint = Color.White.copy(alpha = 0.72f),
            )
            if (unreadCount > 0) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 3.dp, end = 2.dp)
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.92f)),
                )
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = {
                    Text(
                        if (unreadCount > 0) "聊天（${unreadCount.coerceAtMost(99)} 条未读）" else "聊天",
                    )
                },
                leadingIcon = {
                    Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                },
                onClick = {
                    expanded = false
                    onOpenChat()
                },
            )
            if (canAdjustLyricOffset) {
                DropdownMenuItem(
                    text = { Text("歌词时间校正") },
                    leadingIcon = {
                        Icon(Icons.Default.Tune, contentDescription = null)
                    },
                    onClick = {
                        expanded = false
                        onOpenLyricOffset()
                    },
                )
            }
        }
    }
}

@Composable
internal fun LyricOffsetPanel(
    offsetMs: Int,
    onDismiss: () -> Unit,
    onOffsetChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var offsetSeconds by remember(offsetMs) { mutableStateOf(offsetMs / 1_000f) }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color.Black.copy(alpha = 0.24f),
        contentColor = Color.White,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "歌词时间校正",
                        style = MiuixTheme.textStyles.button,
                    )
                    Text(
                        text = lyricOffsetDescription(offsetMs),
                        style = MiuixTheme.textStyles.paragraph,
                        color = Color.White.copy(alpha = 0.72f),
                    )
                }
                IconButton(
                    onClick = { onOffsetChange(0) },
                    enabled = offsetMs != 0,
                ) {
                    Icon(
                        Icons.Default.RestartAlt,
                        contentDescription = "重置歌词校正",
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "关闭歌词校正",
                    )
                }
            }
            PlayerSlider(
                value = offsetSeconds,
                onValueChange = { value ->
                    offsetSeconds = value
                    onOffsetChange((value * 1_000).roundToInt())
                },
                valueRange = -10f..10f,
                steps = 199,
            )
        }
    }
}

private fun lyricOffsetDescription(offsetMs: Int): String =
    when {
        offsetMs > 0 ->
            "歌词延后 ${String.format(java.util.Locale.getDefault(), "%.1f", offsetMs / 1_000.0)} 秒"

        offsetMs < 0 ->
            "歌词提前 ${String.format(java.util.Locale.getDefault(), "%.1f", -offsetMs / 1_000.0)} 秒"

        else -> "未校正"
    }
