package io.github.yueby.musictogether.ui.player

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ListMusic
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.TrackLikeState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text

private val StageTint = Color.White.copy(alpha = 0.75f)

@Composable
internal fun MobileSongInfo(
    track: Track?,
    error: String?,
    modifier: Modifier = Modifier,
    textModifier: Modifier = Modifier,
    layoutScale: Float = 1f,
    onOpenArtist: (() -> Unit)? = null,
    like: TrackLikeState? = null,
    onToggleLike: () -> Unit = {},
    chatUnreadCount: Int = 0,
    onOpenChat: (() -> Unit)? = null,
) {
    val scale = layoutScale.coerceIn(0.5f, 2.2f)
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
    ) {
        SongHandoff(
            target = PortraitTrackText(
                trackId = track?.id,
                title = track?.title ?: "暂无歌曲",
                subtitle = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                isError = error != null,
            ),
            modifier = Modifier.weight(1f).then(textModifier),
        ) { label ->
            Column {
                Text(
                    text = label.title,
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.90f),
                    fontSize = (20f * scale).sp,
                    lineHeight = (25f * scale).sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy((6f * scale).dp),
                ) {
                    Text(
                        text = label.subtitle,
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .basicMarquee()
                            .then(
                                if (onOpenArtist != null && !label.isError) {
                                    Modifier.clickable(onClick = onOpenArtist)
                                } else {
                                    Modifier
                                },
                            ),
                        color = if (label.isError) Color(0xFFFF8A80) else Color.White.copy(alpha = 0.50f),
                        fontSize = (14f * scale).sp,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                    if (!label.isError) QualityBadge(track)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            LikeButton(
                like = like,
                onToggle = onToggleLike,
                size = (20f * scale).dp,
                modifier = Modifier.size((36f * scale).dp),
            )
            if (onOpenChat != null) {
                PlayerChatButton(
                    unreadCount = chatUnreadCount,
                    onClick = onOpenChat,
                    modifier = Modifier.size((36f * scale).dp),
                )
            }
        }
    }
}

@Composable
internal fun MobilePlayerControls(
    track: Track?,
    room: RoomState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
    layoutScale: Float = 1f,
    modifier: Modifier = Modifier,
) {
    val scale = layoutScale.coerceIn(0.5f, 2.2f)
    var seeking by remember(track?.id) { mutableStateOf(false) }
    var seekPosition by remember(track?.id) { mutableDoubleStateOf(player.positionSeconds) }
    LaunchedEffect(player.positionSeconds) {
        if (!seeking) seekPosition = player.positionSeconds
    }
    val reportedDuration = maxOf(track?.duration ?: 0.0, player.durationSeconds)
    val seekRangeDuration = reportedDuration.coerceAtLeast(1.0)
    var transportCoolingDown by remember(track?.id) { mutableStateOf(false) }
    LaunchedEffect(transportCoolingDown) {
        if (transportCoolingDown) {
            kotlinx.coroutines.delay(500)
            transportCoolingDown = false
        }
    }
    fun transport(action: () -> Unit) {
        if (transportCoolingDown) return
        transportCoolingDown = true
        action()
    }
    val hasTrack = track != null
    val displaySettings = LocalPlayerDisplaySettings.current
    val shownPosition = if (track == null) 0.0 else seekPosition
    val timeColor = Color.White.copy(alpha = 0.50f)

    Column(modifier.fillMaxWidth()) {
        PlayerProgressSlider(
            value = seekPosition.coerceIn(0.0, seekRangeDuration).toFloat(),
            maximumValue = seekRangeDuration.toFloat(),
            seeking = seeking,
            playing = player.playing && hasTrack,
            enabled = hasTrack && viewModel.canControl(),
            scale = scale,
            onValueChange = {
                seeking = true
                seekPosition = it.toDouble()
            },
            onValueChangeFinished = {
                seeking = false
                viewModel.seek(seekPosition)
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height((4f * scale).dp))
        Row(Modifier.fillMaxWidth()) {
            Text(
                if (displaySettings.showRemainingTime) {
                    "-" + formatPlayerTime((reportedDuration - shownPosition).coerceAtLeast(0.0))
                } else {
                    formatPlayerTime(shownPosition)
                },
                modifier = Modifier.clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    viewModel.updatePlayerDisplaySettings { it.copy(showRemainingTime = !it.showRemainingTime) }
                },
                color = timeColor,
                fontSize = (12f * scale).sp,
            )
            Spacer(Modifier.weight(1f))
            Text(formatPlayerTime(reportedDuration), color = timeColor, fontSize = (12f * scale).sp)
        }
        ControlsSpectrum(
            visible = displaySettings.controlsSpectrum,
            playing = player.playing,
            height = (48f * scale).dp,
            modifier = Modifier.padding(top = (10f * scale).dp),
        )
        Spacer(Modifier.height((24f * scale).dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                PlayModeButton(
                    playMode = room.playMode,
                    scale = scale,
                    onModeSelected = viewModel::setPlayMode,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
            ) {
                StageButton(
                    onClick = { transport(viewModel::previous) },
                    enabled = hasTrack,
                    modifier = Modifier.size((36f * scale).dp),
                ) {
                    Icon(StageSkipBackIcon, "上一首", Modifier.size((20f * scale).dp), tint = StageTint)
                }
                StageButton(
                    onClick = { transport(viewModel::togglePlayback) },
                    enabled = hasTrack,
                    pressScale = 0.92f,
                    background = Color.White.copy(alpha = 0.20f),
                    modifier = Modifier.size((56f * scale).dp),
                ) {
                    Icon(
                        if (player.playing) StagePauseIcon else StagePlayIcon,
                        contentDescription = if (player.playing) "暂停" else "播放",
                        modifier = Modifier
                            .offset(x = if (player.playing) 0.dp else (2f * scale).dp)
                            .size((28f * scale).dp),
                        tint = Color.White,
                    )
                }
                StageButton(
                    onClick = { transport(viewModel::next) },
                    enabled = hasTrack,
                    modifier = Modifier.size((36f * scale).dp),
                ) {
                    Icon(StageSkipForwardIcon, "下一首", Modifier.size((20f * scale).dp), tint = StageTint)
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                StageButton(onClick = onOpenQueue, modifier = Modifier.size((36f * scale).dp)) {
                    Icon(
                        Lucide.ListMusic,
                        contentDescription = "打开播放队列",
                        modifier = Modifier.size((20f * scale).dp),
                        tint = StageTint,
                    )
                    if (room.queue.isNotEmpty()) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .offset(x = (4f * scale).dp, y = (-4f * scale).dp)
                                .height((16f * scale).dp)
                                .widthIn(min = (16f * scale).dp)
                                .background(Color.White.copy(alpha = 0.90f), CircleShape)
                                .padding(horizontal = (4f * scale).dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = if (room.queue.size > 99) "99+" else room.queue.size.toString(),
                                color = Color.Black,
                                fontSize = (10f * scale).sp,
                                lineHeight = (10f * scale).sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}
