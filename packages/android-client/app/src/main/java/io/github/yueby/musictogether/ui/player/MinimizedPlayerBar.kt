package io.github.yueby.musictogether.ui.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState

@Composable
internal fun MinimizedPlayerBar(
    track: Track?,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onExpand: () -> Unit,
    onOpenQueue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val contentColor = MaterialTheme.colorScheme.onSurface
    val secondaryColor = MaterialTheme.colorScheme.onSurfaceVariant
    val enabled = track != null

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier
                .height(76.dp)
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onExpand)
                    .padding(end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PlayerArtwork(
                    track = track,
                    cornerRadius = 8.dp,
                    placeholderIconSize = 22.dp,
                    contentDescription = track?.title,
                    modifier = Modifier.size(56.dp),
                )
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Column {
                        Text(
                            text = track?.title ?: "暂无歌曲",
                            color = contentColor,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = track?.artist?.joinToString(" / ") ?: "点击打开播放器",
                            color = secondaryColor,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            IconButton(
                onClick = viewModel::togglePlayback,
                enabled = enabled,
            ) {
                Icon(
                    imageVector = if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (player.playing) "暂停" else "播放",
                    tint = if (enabled) contentColor else secondaryColor.copy(alpha = 0.38f),
                )
            }
            IconButton(onClick = onOpenQueue) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.QueueMusic,
                    contentDescription = "打开播放列表",
                    tint = contentColor,
                )
            }
        }
    }
}
