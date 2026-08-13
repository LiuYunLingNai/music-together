package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState

@Composable
internal fun MobileSongInfo(
    track: Track?,
    error: String?,
    chatUnreadCount: Int,
    onOpenChat: () -> Unit,
    layoutScale: Float = 1f,
) {
    val scale = layoutScale.coerceIn(0.52f, 1.08f)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
    ) {
        Crossfade(
            targetState = PortraitTrackText(
                trackId = track?.id,
                title = track?.title ?: "暂无歌曲",
                subtitle = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                isError = error != null,
            ),
            animationSpec = tween(280),
            modifier = Modifier.weight(1f),
            label = "track-text-crossfade",
        ) { label ->
            Column {
                Text(
                    text = label.title,
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.94f),
                    fontSize = (20f * scale).sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
                Text(
                    text = label.subtitle,
                    modifier = Modifier.basicMarquee(),
                    color = if (label.isError) Color(0xFFFF8A80) else Color.White.copy(alpha = 0.52f),
                    fontSize = (14f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
            }
        }
        PlayerChatButton(
            unreadCount = chatUnreadCount,
            onClick = onOpenChat,
            modifier = Modifier.size((40f * scale).dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
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
    val scale = layoutScale.coerceIn(0.52f, 1.08f)
    var seeking by remember(track?.id) { mutableStateOf(false) }
    var seekPosition by remember(track?.id) { mutableDoubleStateOf(player.positionSeconds) }
    LaunchedEffect(player.positionSeconds) {
        if (!seeking) seekPosition = player.positionSeconds
    }
    val reportedDuration = maxOf(track?.duration ?: 0.0, player.durationSeconds)
    val seekRangeDuration = reportedDuration.coerceAtLeast(1.0)
    val playInteraction = remember { MutableInteractionSource() }
    val playPressed by playInteraction.collectIsPressedAsState()
    val playButtonScale by animateFloatAsState(
        targetValue = if (playPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.76f, stiffness = 520f),
        label = "play-button-press",
    )
    var transportCoolingDown by remember(track?.id) { mutableStateOf(false) }
    LaunchedEffect(transportCoolingDown) {
        if (transportCoolingDown) {
            kotlinx.coroutines.delay(500)
            transportCoolingDown = false
        }
    }
    val transportEnabled = track != null && !transportCoolingDown

    Column(modifier.fillMaxWidth()) {
        PlayerProgressSlider(
            value = seekPosition.coerceIn(0.0, seekRangeDuration).toFloat(),
            maximumValue = seekRangeDuration.toFloat(),
            seeking = seeking,
            enabled = track != null && viewModel.canControl(),
            scale = scale,
            onValueChange = {
                seeking = true
                seekPosition = it.toDouble()
            },
            onValueChangeFinished = {
                seeking = false
                viewModel.seek(seekPosition)
            },
            modifier = Modifier
                .fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth()) {
            Text(
                formatPlayerTime(if (track == null) 0.0 else seekPosition),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = (11f * scale).sp,
            )
            Spacer(Modifier.weight(1f))
            Text(
                formatPlayerTime(reportedDuration),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = (11f * scale).sp,
            )
        }
        Spacer(Modifier.height((16f * scale).dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                PlayModeMenuButton(
                    playMode = room.playMode,
                    enabled = track != null,
                    scale = scale,
                    onModeSelected = viewModel::setPlayMode,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy((8f * scale).dp),
            ) {
                IconButton(
                    onClick = {
                        transportCoolingDown = true
                        viewModel.previous()
                    },
                    enabled = transportEnabled,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Icon(
                        Icons.Default.SkipPrevious,
                        contentDescription = "上一首",
                        modifier = Modifier.size((24f * scale).dp),
                        tint = Color.White.copy(alpha = if (transportEnabled) 0.84f else 0.28f),
                    )
                }
                IconButton(
                    onClick = {
                        transportCoolingDown = true
                        viewModel.togglePlayback()
                    },
                    enabled = transportEnabled,
                    interactionSource = playInteraction,
                    modifier = Modifier
                        .size((56f * scale).dp)
                        .graphicsLayer {
                            scaleX = playButtonScale
                            scaleY = playButtonScale
                        }
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.20f)),
                ) {
                    Icon(
                        if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (player.playing) "暂停" else "播放",
                        modifier = Modifier.size((30f * scale).dp),
                        tint = Color.White.copy(alpha = if (transportEnabled) 0.94f else 0.28f),
                    )
                }
                IconButton(
                    onClick = {
                        transportCoolingDown = true
                        viewModel.next()
                    },
                    enabled = transportEnabled,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Icon(
                        Icons.Default.SkipNext,
                        contentDescription = "下一首",
                        modifier = Modifier.size((24f * scale).dp),
                        tint = Color.White.copy(alpha = if (transportEnabled) 0.84f else 0.28f),
                    )
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                IconButton(
                    onClick = onOpenQueue,
                    modifier = Modifier.size((42f * scale).dp),
                ) {
                    Box(Modifier.size((30f * scale).dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.QueueMusic,
                            contentDescription = "打开播放队列",
                            modifier = Modifier.align(Alignment.Center),
                            tint = Color.White.copy(alpha = 0.72f),
                        )
                        if (room.queue.isNotEmpty()) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .height((15f * scale).dp)
                                    .widthIn(min = (15f * scale).dp)
                                    .clip(CircleShape)
                                    .background(Color.White.copy(alpha = 0.90f))
                                    .padding(horizontal = (2f * scale).dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = if (room.queue.size > 99) "99+" else room.queue.size.toString(),
                                    color = Color.Black,
                                    fontSize = (7f * scale).sp,
                                    lineHeight = (7f * scale).sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
