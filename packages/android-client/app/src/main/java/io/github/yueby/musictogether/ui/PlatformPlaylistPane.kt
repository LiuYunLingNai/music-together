package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.LocalAppWindowSheet
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton

private val platformOptions = listOf(
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
    "bilibili" to "B站",
)

@Composable
internal fun PlaylistRow(playlist: Playlist, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick),
        leadingContent = {
            AsyncImage(
                model = playlist.cover,
                contentDescription = playlist.name,
                modifier = Modifier.size(54.dp).clip(RoundedCornerShape(9.dp)),
                contentScale = ContentScale.Crop,
            )
        },
        headlineContent = { Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                "${playlist.trackCount} 首${playlist.creator?.let { " · $it" }.orEmpty()}",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

@Composable
internal fun PlaylistDetailPane(state: AppState, playlist: Playlist, viewModel: MusicTogetherViewModel) {
    val hub = state.platformHub
    val listState = rememberLazyListState()
    val queueKeys = state.room?.queue.orEmpty().mapTo(hashSetOf()) { it.queueIdentity() }
    val availableCount = (1000 - (state.room?.queue?.size ?: 0)).coerceAtLeast(0)
    val addableCount = hub.playlistTracks
        .distinctBy { it.queueIdentity() }
        .count { it.queueIdentity() !in queueKeys }
        .coerceAtMost(availableCount)
    val shouldLoadMore by remember(
        listState,
        hub.playlistTracks.size,
        hub.playlistHasMore,
        hub.playlistLoadingMore,
    ) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            hub.playlistHasMore && !hub.playlistLoadingMore &&
                hub.playlistTracks.isNotEmpty() && lastVisible >= hub.playlistTracks.lastIndex - 3
        }
    }
    LaunchedEffect(shouldLoadMore, hub.playlistTracks.size) {
        if (shouldLoadMore) viewModel.loadMorePlaylistTracks()
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = if (LocalAppWindowSheet.current) 0.dp else 8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!LocalAppWindowSheet.current) {
                if (LocalUiStyle.current == UiStyle.Miuix) {
                    MiuixIconButton(onClick = viewModel::closePlaylist) {
                        MiuixIcon(Icons.AutoMirrored.Filled.ArrowBack, "返回歌单列表")
                    }
                } else {
                    IconButton(onClick = viewModel::closePlaylist) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回歌单列表")
                    }
                }
            }
            Column(Modifier.weight(1f)) {
                Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                Text(
                    when {
                        hub.playlistLoading -> "加载中…"
                        hub.playlistAddingAll -> "正在加载全部 · ${hub.playlistTracks.size}/${hub.playlistTotal}"
                        else -> "${hub.playlistTotal} 首 · 已加载 ${hub.playlistTracks.size}"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val addAllEnabled = !hub.playlistLoading && !hub.playlistLoadingMore && !hub.playlistAddingAll &&
                availableCount > 0 && (hub.playlistHasMore || addableCount > 0)
            val addAllLabel = when {
                hub.playlistAddingAll -> "加载全部"
                availableCount <= 0 -> "队列已满"
                hub.playlistHasMore -> "添加全部"
                addableCount > 0 -> "添加 $addableCount 首"
                else -> "已添加"
            }
            if (LocalUiStyle.current == UiStyle.Miuix) {
                AppButton(
                    text = addAllLabel,
                    onClick = { viewModel.addPlaylistTracksToQueue(playlist) },
                    enabled = addAllEnabled,
                )
            } else FilledTonalButton(
                onClick = { viewModel.addPlaylistTracksToQueue(playlist) },
                enabled = addAllEnabled,
            ) {
                if (hub.playlistAddingAll) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null, Modifier.size(18.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text(addAllLabel)
            }
        }
        HorizontalDivider()
        when {
            hub.playlistLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            hub.playlistError != null && hub.playlistTracks.isEmpty() -> Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(hub.playlistError, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { viewModel.openPlaylist(playlist) }) { Text("重试") }
            }
            hub.playlistTracks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    if (playlist.source == "bilibili") "收藏夹为空" else "歌单为空",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(start = 0.dp, top = 6.dp, end = 0.dp, bottom = 20.dp),
            ) {
                items(hub.playlistTracks, key = { "${it.source}:${it.id}" }) { track ->
                    PlatformTrackRow(
                        track = track,
                        isAdded = track.queueIdentity() in queueKeys,
                        onAdd = { viewModel.addTrack(track) },
                        onPin = { viewModel.insertAfterCurrent(track) },
                    )
                    HorizontalDivider()
                }
                if (hub.playlistLoadingMore) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                } else if (hub.playlistError != null) {
                    item {
                        TextButton(
                            onClick = viewModel::loadMorePlaylistTracks,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("加载失败，点击重试") }
                    }
                } else if (!hub.playlistHasMore) {
                    item {
                        Text(
                            "已经到底了",
                            Modifier.fillMaxWidth().padding(18.dp),
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun PlatformTrackRow(track: Track, isAdded: Boolean, onAdd: () -> Unit, onPin: () -> Unit) {
    ListItem(
        modifier = if (isAdded) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().clickable(onClick = onAdd),
        colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
        leadingContent = {
            TrackCover(
                track = track,
                size = 50.dp,
                cornerRadius = 8.dp,
                contentDescription = null,
            )
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                "${track.artist.joinToString(" / ")} · ${track.album}",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        trailingContent = {
            Row {
                IconButton(onClick = onAdd, enabled = !isAdded) {
                    Icon(
                        if (isAdded) Icons.Default.Check else Icons.AutoMirrored.Filled.PlaylistAdd,
                        if (isAdded) "已添加" else "添加到播放列表",
                        tint = if (isAdded) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                }
                if (!isAdded) {
                    IconButton(onClick = onPin) {
                        Icon(Icons.Default.VerticalAlignTop, "置顶到当前播放下方")
                    }
                }
            }
        },
    )
}
