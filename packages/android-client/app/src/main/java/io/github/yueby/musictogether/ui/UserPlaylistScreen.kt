package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppLoadingState
import io.github.yueby.musictogether.ui.designsystem.AppPage
import io.github.yueby.musictogether.ui.player.DropdownMenu
import io.github.yueby.musictogether.ui.player.DropdownMenuItem
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun UserPlaylistScreen(
    id: String,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    onBack: () -> Unit,
) {
    val playlists by viewModel.userPlaylistState.collectAsStateWithLifecycle()
    val detailState = playlists.detail?.takeIf { it.id == id }
    val detail = detailState?.detail
    val summary = playlists.playlists.firstOrNull { it.id == id }
    val name = detail?.playlist?.name ?: summary?.name ?: "歌单"
    val queueKeys = rememberQueueKeys(state)
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }

    AppPage(
        title = name,
        onBack = onBack,
        actions = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "歌单操作") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("重命名") },
                        leadingIcon = { Icon(Icons.Default.Edit, null) },
                        onClick = {
                            menu = false
                            renaming = true
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("删除歌单", color = MiuixTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Default.Delete, null, tint = MiuixTheme.colorScheme.error) },
                        onClick = {
                            menu = false
                            deleting = true
                        },
                    )
                }
            }
        },
    ) {
        when {
            detailState == null || (detailState.loading && detail == null) -> AppLoadingState()
            detail == null -> AppEmptyState(
                icon = Icons.Default.ErrorOutline,
                title = "歌单加载失败",
                summary = detailState.error,
                actionText = "重试",
                onAction = { viewModel.openUserPlaylist(id) },
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().overScrollVertical(),
                contentPadding = PaddingValues(bottom = 20.dp),
            ) {
                item(key = "header") {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            UserPlaylistCover(detail.playlist.cover, 96.dp)
                            Column(Modifier.weight(1f).padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    detail.playlist.name,
                                    style = MiuixTheme.textStyles.title4,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    "${detail.tracks.size} 首 · 账户歌单",
                                    style = MiuixTheme.textStyles.body2,
                                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                )
                            }
                        }
                        if (state.room != null && detail.tracks.isNotEmpty()) {
                            AppButton(
                                text = "全部点歌",
                                onClick = { viewModel.addTracksToQueue(detail.tracks, detail.playlist.name) },
                                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            )
                        }
                    }
                }
                if (detail.tracks.isEmpty()) {
                    item(key = "empty") {
                        AppEmptyState(
                            icon = Icons.AutoMirrored.Filled.QueueMusic,
                            title = "歌单还是空的",
                            summary = "在任意歌曲的「更多」菜单里选择「添加到歌单」",
                        )
                    }
                }
                itemsIndexed(detail.tracks, key = { _, track -> "${track.source}:${track.id}" }) { index, track ->
                    MusicTrackItem(track, state, viewModel, queueKeys, index = index + 1, userPlaylistId = id)
                }
            }
        }
    }

    if (renaming) {
        NameInputDialog(
            title = "重命名歌单",
            initialValue = name,
            confirmText = "保存",
            onDismiss = { renaming = false },
        ) { value ->
            renaming = false
            viewModel.renameUserPlaylist(id, value)
        }
    }
    if (deleting) {
        AppDialog(
            title = "删除歌单",
            onDismissRequest = { deleting = false },
            confirmText = "删除",
            onConfirm = {
                deleting = false
                viewModel.deleteUserPlaylist(id, onDeleted = onBack)
            },
        ) {
            Text("「$name」将被永久删除，歌单中的歌曲不会受影响。", color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        }
    }
}
