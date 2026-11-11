package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LibraryAdd
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UserPlaylistAccess
import io.github.yueby.musictogether.model.offlineDownloadKey
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppTextField
import io.github.yueby.musictogether.ui.player.DropdownMenu
import io.github.yueby.musictogether.ui.player.DropdownMenuItem
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun rememberQueueKeys(state: AppState): Set<String> {
    val queue = state.room?.queue
    return remember(queue) { queue.orEmpty().mapTo(hashSetOf()) { it.queueIdentity() } }
}

@Composable
internal fun MusicTrackItem(
    track: Track,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    queueKeys: Set<String>,
    modifier: Modifier = Modifier,
    index: Int? = null,
    userPlaylistId: String? = null,
    multiLine: Boolean = false,
) {
    val inRoom = state.room != null
    val added = inRoom && track.queueIdentity() in queueKeys
    var menuOpen by remember { mutableStateOf(false) }
    val onRowClick = rememberHapticClick {
        if (inRoom && !added) viewModel.addTrack(track) else menuOpen = true
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onRowClick)
            .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        index?.let {
            Text(
                text = it.toString(),
                modifier = Modifier.width(30.dp),
                textAlign = TextAlign.Center,
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        TrackCover(track = track, size = 48.dp, cornerRadius = 9.dp)
        Column(
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                track.title,
                maxLines = if (multiLine) 2 else 1,
                overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body1,
                fontWeight = FontWeight.Medium,
                color = if (added) MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.onSurface,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                TrackPlatformBadge(track.source)
                if (track.vip) TrackVipBadge()
                Text(
                    listOf(track.artist.joinToString(" / "), track.album).filter { it.isNotBlank() }.joinToString(" · "),
                    maxLines = if (multiLine) 2 else 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                )
            }
        }
        if (inRoom) {
            IconButton(onClick = { viewModel.addTrack(track) }, enabled = !added) {
                Icon(
                    if (added) Icons.Default.Check else Icons.AutoMirrored.Filled.PlaylistAdd,
                    contentDescription = if (added) "已在队列" else "点歌",
                    tint = if (added) MiuixTheme.colorScheme.primary else MiuixTheme.colorScheme.onSurfaceVariantActions,
                )
            }
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Default.MoreVert, "更多操作", tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
            }
            TrackActionsMenu(
                expanded = menuOpen,
                onDismiss = { menuOpen = false },
                track = track,
                state = state,
                viewModel = viewModel,
                added = added,
                userPlaylistId = userPlaylistId,
            )
        }
    }
}

@Composable
private fun TrackVipBadge() {
    Text(
        "VIP",
        style = MiuixTheme.textStyles.footnote2,
        color = MiuixTheme.colorScheme.primary,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun TrackActionsMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    track: Track,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    added: Boolean,
    userPlaylistId: String?,
) {
    val navigator = LocalAppNavigator.current
    val inRoom = state.room != null
    val downloadKey = track.offlineDownloadKey()
    val downloaded = state.offlineLibrary.tracks.any { it.key == downloadKey }
    val download = state.offlineLibrary.downloads[downloadKey]
    var pickPlaylist by remember { mutableStateOf(false) }
    val artistId = track.artistIds.firstOrNull()?.takeIf { track.source == CatalogSourceName }

    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        fun act(block: () -> Unit) {
            onDismiss()
            block()
        }
        if (inRoom) {
            DropdownMenuItem(
                text = { Text(if (added) "已在播放队列" else "点歌") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.QueueMusic, null) },
                enabled = !added,
                onClick = { act { viewModel.addTrack(track) } },
            )
            DropdownMenuItem(
                text = { Text("下一首播放") },
                leadingIcon = { Icon(Icons.Default.VerticalAlignTop, null) },
                enabled = !added,
                onClick = { act { viewModel.insertAfterCurrent(track) } },
            )
        } else if (downloaded) {
            DropdownMenuItem(
                text = { Text("播放本地文件") },
                leadingIcon = { Icon(Icons.Default.PlayArrow, null) },
                onClick = { act { viewModel.playDownloadedTrack(track) } },
            )
        }
        DropdownMenuItem(
            text = {
                Text(
                    when {
                        downloaded -> "已下载"
                        download?.progressPercent != null -> "下载中 ${download.progressPercent}%"
                        download != null -> "下载中"
                        else -> "下载"
                    },
                )
            },
            leadingIcon = {
                when {
                    downloaded -> Icon(Icons.Default.Check, null, tint = MiuixTheme.colorScheme.primary)
                    download != null -> CircularProgressIndicator(
                        progress = (download.progressPercent ?: 0) / 100f,
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                    )
                    else -> Icon(Icons.Default.Download, null)
                }
            },
            enabled = !downloaded && download == null,
            onClick = { act { viewModel.downloadTrack(track) } },
        )
        DropdownMenuItem(
            text = { Text("添加到歌单") },
            leadingIcon = { Icon(Icons.Default.LibraryAdd, null) },
            onClick = { act { pickPlaylist = true } },
        )
        if (inRoom && track.source == CatalogSourceName) {
            DropdownMenuItem(
                text = { Text("收藏到网易云") },
                leadingIcon = { Icon(Icons.Default.Favorite, null) },
                onClick = { act { viewModel.likeTrack(track) } },
            )
        }
        artistId?.let { id ->
            DropdownMenuItem(
                text = { Text("查看歌手") },
                leadingIcon = { Icon(Icons.Default.Person, null) },
                onClick = { act { navigator.openArtist(track.source, id) } },
            )
        }
        userPlaylistId?.let { playlistId ->
            DropdownMenuItem(
                text = { Text("从歌单移除", color = MiuixTheme.colorScheme.error) },
                leadingIcon = { Icon(Icons.Default.Delete, null, tint = MiuixTheme.colorScheme.error) },
                onClick = { act { viewModel.removeFromUserPlaylist(playlistId, track) } },
            )
        }
    }

    if (pickPlaylist) {
        AddToUserPlaylistDialog(
            tracks = listOf(track),
            viewModel = viewModel,
            onDismiss = { pickPlaylist = false },
        )
    }
}

internal const val CatalogSourceName = "netease"

@Composable
internal fun AddToUserPlaylistDialog(
    tracks: List<Track>,
    viewModel: MusicTogetherViewModel,
    onDismiss: () -> Unit,
) {
    val playlists by viewModel.userPlaylistState.collectAsStateWithLifecycle()
    val navigator = LocalAppNavigator.current
    var creating by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.loadUserPlaylists() }

    if (playlists.access == UserPlaylistAccess.RequiresPassword) {
        AppDialog(
            title = "需要账号密码",
            onDismissRequest = onDismiss,
            confirmText = "去设置",
            onConfirm = {
                onDismiss()
                navigator.open(AppRoute.Account)
            },
        ) {
            Text(
                "账户歌单保存在服务器上，需要先为当前账号设置密码。",
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        return
    }

    AppDialog(
        title = if (creating) "新建歌单" else "添加到歌单",
        onDismissRequest = onDismiss,
        confirmText = if (creating) "创建并添加" else "新建歌单",
        confirmEnabled = !playlists.busy && (!creating || name.isNotBlank()),
        onConfirm = {
            if (creating) {
                viewModel.createUserPlaylist(name, tracks)
                onDismiss()
            } else {
                creating = true
            }
        },
    ) {
        when {
            creating -> AppTextField(
                value = name,
                onValueChange = { name = it.take(100) },
                label = "歌单名称",
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            playlists.loading && playlists.playlists.isEmpty() -> Box(
                Modifier.fillMaxWidth().padding(24.dp),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
            playlists.error != null && playlists.playlists.isEmpty() -> Text(
                playlists.error.orEmpty(),
                color = MiuixTheme.colorScheme.error,
            )
            playlists.playlists.isEmpty() -> Text(
                "还没有歌单，先新建一个吧。",
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
            else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
                items(playlists.playlists, key = { it.id }) { playlist ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                viewModel.addToUserPlaylist(playlist.id, tracks)
                                onDismiss()
                            }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        UserPlaylistCover(playlist.cover, size = 40.dp)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                "${playlist.trackCount} 首",
                                style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                        Icon(Icons.Default.Add, null, tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
                    }
                }
            }
        }
    }
}

@Composable
internal fun NameInputDialog(
    title: String,
    initialValue: String,
    confirmText: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember(initialValue) { mutableStateOf(initialValue) }
    AppDialog(
        title = title,
        onDismissRequest = onDismiss,
        confirmText = confirmText,
        confirmEnabled = value.isNotBlank(),
        onConfirm = { onConfirm(value.trim()) },
    ) {
        AppTextField(
            value = value,
            onValueChange = { value = it.take(100) },
            label = "歌单名称",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
