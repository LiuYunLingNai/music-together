package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppLoadingState
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun PlaylistRow(playlist: Playlist, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = playlist.cover,
            contentDescription = playlist.name,
            modifier = Modifier.size(54.dp).clip(RoundedCornerShape(10.dp)),
            contentScale = ContentScale.Crop,
        )
        Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                playlist.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body1,
                fontWeight = FontWeight.Medium,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                TrackPlatformBadge(playlist.source)
                Text(
                    buildString {
                        append(if (playlist.isAlbum) "专辑" else "${playlist.trackCount} 首")
                        playlist.creator?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                )
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MiuixTheme.colorScheme.onSurfaceVariantActions,
        )
    }
}

@Composable
internal fun PlaylistDetailPane(state: AppState, playlist: Playlist, viewModel: MusicTogetherViewModel) {
    val hub = state.platformHub
    val listState = rememberLazyListState()
    val queueKeys = rememberQueueKeys(state)
    val inRoom = state.room != null
    val availableCount = (1000 - (state.room?.queue?.size ?: 0)).coerceAtLeast(0)
    val addableCount = hub.playlistTracks
        .distinctBy { it.queueIdentity() }
        .count { it.queueIdentity() !in queueKeys }
        .coerceAtMost(availableCount)
    val shouldLoadMore by remember(listState, hub.playlistTracks.size, hub.playlistHasMore, hub.playlistLoadingMore) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            hub.playlistHasMore && !hub.playlistLoadingMore &&
                hub.playlistTracks.isNotEmpty() && lastVisible >= hub.playlistTracks.size - 2
        }
    }
    LaunchedEffect(shouldLoadMore, hub.playlistTracks.size) {
        if (shouldLoadMore) viewModel.loadMorePlaylistTracks()
    }

    when {
        hub.playlistLoading -> AppLoadingState()
        hub.playlistError != null && hub.playlistTracks.isEmpty() -> AppEmptyState(
            icon = Icons.Default.ErrorOutline,
            title = "加载失败",
            summary = hub.playlistError,
            actionText = "重试",
            onAction = { viewModel.openPlaylist(playlist) },
        )
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize().overScrollVertical(),
            state = listState,
            contentPadding = PaddingValues(bottom = 20.dp),
        ) {
            item(key = "header") {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(
                            model = playlist.cover,
                            contentDescription = playlist.name,
                            modifier = Modifier.size(96.dp).clip(RoundedCornerShape(14.dp)),
                            contentScale = ContentScale.Crop,
                        )
                        Column(Modifier.weight(1f).padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                playlist.name,
                                style = MiuixTheme.textStyles.title4,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            playlist.creator?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MiuixTheme.textStyles.body2, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                TrackPlatformBadge(playlist.source)
                                Text(
                                    if (hub.playlistAddingAll) {
                                        "正在加载全部 ${hub.playlistTracks.size}/${hub.playlistTotal}"
                                    } else {
                                        "${hub.playlistTotal} 首"
                                    },
                                    style = MiuixTheme.textStyles.footnote1,
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                )
                            }
                        }
                    }
                    playlist.description?.takeIf { it.isNotBlank() }?.let {
                        Text(
                            it,
                            modifier = Modifier.padding(top = 10.dp),
                            style = MiuixTheme.textStyles.body2,
                            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (inRoom) {
                        val addAllEnabled = !hub.playlistLoadingMore && !hub.playlistAddingAll &&
                            availableCount > 0 && (hub.playlistHasMore || addableCount > 0)
                        AppButton(
                            text = when {
                                hub.playlistAddingAll -> "正在加载全部…"
                                availableCount <= 0 -> "播放队列已满"
                                hub.playlistHasMore -> "全部点歌"
                                addableCount > 0 -> "点歌 $addableCount 首"
                                else -> "已全部在队列"
                            },
                            onClick = { viewModel.addPlaylistTracksToQueue(playlist) },
                            enabled = addAllEnabled,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        )
                    }
                }
            }
            if (hub.playlistTracks.isEmpty()) {
                item(key = "empty") {
                    AppEmptyState(
                        icon = Icons.AutoMirrored.Filled.QueueMusic,
                        title = if (playlist.source == "bilibili") "收藏夹为空" else "歌单为空",
                    )
                }
            }
            itemsIndexed(hub.playlistTracks, key = { _, track -> "${track.source}:${track.id}" }) { index, track ->
                MusicTrackItem(track, state, viewModel, queueKeys, index = index + 1)
            }
            item(key = "footer") {
                when {
                    hub.playlistLoadingMore -> Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    }
                    hub.playlistError != null -> TextButton(
                        text = "加载失败，点击重试",
                        onClick = viewModel::loadMorePlaylistTracks,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    hub.playlistTracks.isNotEmpty() && !hub.playlistHasMore -> Text(
                        "已经到底了",
                        Modifier.fillMaxWidth().padding(18.dp),
                        textAlign = TextAlign.Center,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
    }
}
