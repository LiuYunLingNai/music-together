package io.github.yueby.musictogether.ui

import top.yukonga.miuix.kmp.utils.overScrollVertical
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import androidx.compose.foundation.layout.PaddingValues
import io.github.yueby.musictogether.ui.designsystem.AppListItem
import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.LinearProgressIndicator
import top.yukonga.miuix.kmp.basic.Slider
import top.yukonga.miuix.kmp.basic.Surface
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.DownloadedTrack
import io.github.yueby.musictogether.player.PlayerUiState

@Composable
internal fun LocalMusicPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val player by viewModel.playerState.collectAsStateWithLifecycle()
    val library = state.offlineLibrary
    Column(Modifier.fillMaxSize()) {
        player.takeIf { it.localPlayback }?.let { localPlayer ->
            LocalPlaybackBar(player = localPlayer, viewModel = viewModel)
            HorizontalDivider()
        }
        if (library.tracks.isEmpty() && library.downloads.isEmpty()) {
            AppEmptyState(
                icon = Icons.Default.Download,
                title = "暂无已下载歌曲",
                summary = "在歌曲的「更多」菜单里选择「下载」，离开房间后也能播放",
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).overScrollVertical(),
                contentPadding = PaddingValues(bottom = 16.dp + contentPadding.calculateBottomPadding()),
            ) {
                if (library.downloads.isNotEmpty()) {
                    item(key = "downloads-header") {
                        Text(
                            "正在下载",
                            modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 4.dp),
                            style = MiuixTheme.textStyles.button,
                            color = MiuixTheme.colorScheme.primary,
                        )
                    }
                    items(library.downloads.entries.toList(), key = { it.key }) { (_, download) ->
                        download.track?.let { track ->
                            DownloadingTrackRow(track = track, progressPercent = download.progressPercent)
                            HorizontalDivider()
                        }
                    }
                }
                items(library.tracks, key = { it.key }) { downloaded ->
                    DownloadedTrackRow(
                        downloaded = downloaded,
                        onPlay = { viewModel.playDownloadedTrack(downloaded.track) },
                        onDelete = { viewModel.removeDownloadedTrack(downloaded.track) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun DownloadingTrackRow(track: io.github.yueby.musictogether.model.Track, progressPercent: Int?) {
    AppListItem(
        leadingContent = {
            TrackCover(
                track = track,
                size = 48.dp,
                cornerRadius = 8.dp,
                contentDescription = null,
            )
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Column {
                Text(
                    progressPercent?.let { "正在下载 · $it%" } ?: "正在下载",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body2,
            )
                if (progressPercent == null) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                } else {
                    LinearProgressIndicator(
                        progress = progressPercent.coerceIn(0, 100) / 100f,
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    )
                }
            }
        },
    )
}

@Composable
private fun LocalPlaybackBar(player: PlayerUiState, viewModel: MusicTogetherViewModel) {
    var seeking by remember(player.track?.id) { mutableStateOf(false) }
    var position by remember(player.track?.id) { mutableDoubleStateOf(player.positionSeconds) }
    val duration = maxOf(player.durationSeconds, player.track?.duration ?: 0.0).coerceAtLeast(1.0)
    LaunchedEffect(player.positionSeconds) {
        if (!seeking) position = player.positionSeconds
    }
    Surface(color = MiuixTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.MusicNote, null, tint = MiuixTheme.colorScheme.primary)
                Text(
                    player.track?.title.orEmpty(),
                    modifier = Modifier.weight(1f).padding(start = 10.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = viewModel::togglePlayback) {
                    Icon(if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow, "播放或暂停")
                }
            }
            Slider(
                value = position.coerceIn(0.0, duration).toFloat(),
                onValueChange = {
                    seeking = true
                    position = it.toDouble()
                },
                onValueChangeFinished = {
                    seeking = false
                    viewModel.seek(position)
                },
                valueRange = 0f..duration.toFloat(),
            )
        }
    }
}

@Composable
private fun DownloadedTrackRow(
    downloaded: DownloadedTrack,
    onPlay: () -> Unit,
    onDelete: () -> Unit,
) {
    val track = downloaded.track
    AppListItem(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onPlay),
        leadingContent = {
            TrackCover(
                track = track,
                size = 48.dp,
                cornerRadius = 8.dp,
                contentDescription = null,
            )
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                "${track.artist.joinToString(" / ")} · ${formatOfflineSize(downloaded.sizeBytes)}",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body2,
            )
        },
        trailingContent = {
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "删除本地歌曲")
            }
        },
    )
}

private fun formatOfflineSize(bytes: Long): String = when {
    bytes >= 1024L * 1024 -> "${bytes / (1024L * 1024)} MB"
    bytes >= 1024L -> "${bytes / 1024} KB"
    else -> "$bytes B"
}
