package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.CircleAlert
import com.composables.icons.lucide.Flame
import com.composables.icons.lucide.RefreshCw
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.catalog.HotSongsSources
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppLoadingState
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.TabRow
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

private val hotSourceLabels = mapOf("netease" to "网易云", "tencent" to "QQ 音乐", "kugou" to "酷狗")
private val rankColors = listOf(Color(0xFFF87171), Color(0xFFFB923C), Color(0xFFFACC15))

@Composable
internal fun HotSongsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val hot by viewModel.hotSongsState.collectAsStateWithLifecycle()
    val queueKeys = rememberQueueKeys(state)
    LaunchedEffect(state.room?.id) { viewModel.loadHotSongs() }

    Column(Modifier.fillMaxSize()) {
        TabRow(
            tabs = HotSongsSources.map { hotSourceLabels.getValue(it) },
            selectedTabIndex = HotSongsSources.indexOf(hot.source).coerceAtLeast(0),
            onTabSelected = { viewModel.loadHotSongs(HotSongsSources[it]) },
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
        Box(Modifier.weight(1f)) {
            when {
                hot.loading && hot.tracks.isEmpty() -> AppLoadingState()
                hot.error != null && hot.tracks.isEmpty() -> AppEmptyState(
                    icon = Lucide.CircleAlert,
                    title = "热歌榜加载失败",
                    summary = hot.error,
                    actionText = "重试",
                    onAction = { viewModel.loadHotSongs(refresh = true) },
                )
                hot.tracks.isEmpty() -> AppEmptyState(Lucide.Flame, "暂无热歌")
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().overScrollVertical(),
                    contentPadding = PaddingValues(bottom = 12.dp),
                ) {
                    itemsIndexed(hot.tracks, key = { _, track -> "${track.source}:${track.sourceId}:${track.id}" }) { index, track ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                (index + 1).toString(),
                                modifier = Modifier.padding(start = 12.dp).size(width = 22.dp, height = 20.dp),
                                textAlign = TextAlign.Center,
                                fontWeight = FontWeight.Bold,
                                color = rankColors.getOrNull(index) ?: MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                            MusicTrackItem(track, state, viewModel, queueKeys, modifier = Modifier.weight(1f))
                        }
                    }
                    item(key = "footer") {
                        when {
                            hot.loadingMore -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                            }
                            hot.error != null -> TextButton(text = "加载失败，点击重试", onClick = viewModel::loadMoreHotSongs, modifier = Modifier.fillMaxWidth())
                            hot.hasMore -> LaunchedEffect(hot.tracks.size) { viewModel.loadMoreHotSongs() }
                            else -> Text(
                                "已加载全部 ${hot.tracks.size} 首",
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                textAlign = TextAlign.Center,
                                style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun HotSongsRefreshAction(viewModel: MusicTogetherViewModel) {
    val hot by viewModel.hotSongsState.collectAsStateWithLifecycle()
    IconButton(onClick = { viewModel.loadHotSongs(refresh = true) }, enabled = !hot.loading) {
        Icon(Lucide.RefreshCw, "刷新热歌榜")
    }
}
