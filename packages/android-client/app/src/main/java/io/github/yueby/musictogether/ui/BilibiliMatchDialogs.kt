package io.github.yueby.musictogether.ui

import io.github.yueby.musictogether.ui.designsystem.AppListItem
import io.github.yueby.musictogether.ui.designsystem.AppChip
import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.HorizontalDivider
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.BilibiliCollectionState
import io.github.yueby.musictogether.model.BilibiliMetadataMatchState
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppTextField

@Composable
internal fun BilibiliCollectionDialog(
    collection: BilibiliCollectionState,
    viewModel: MusicTogetherViewModel,
) {
    if (collection.track == null) return
    AppDialog(
        onDismissRequest = viewModel::dismissBilibiliCollection,
        title = if (collection.loading) "正在读取视频分集" else "选择视频：${collection.title}",
        confirmText = "按当前视频播放",
        onConfirm = viewModel::skipBilibiliCollection,
    ) {
            when {
                collection.loading -> Box(
                    Modifier.fillMaxWidth().padding(28.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
                collection.error != null -> Text(collection.error, color = MiuixTheme.colorScheme.error)
                else -> LazyColumn(Modifier.fillMaxWidth().height(320.dp)) {
                    items(collection.tracks, key = { it.id }) { part ->
                        AppListItem(
                            headlineContent = {
                                Text(part.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            },
                            supportingContent = {
                                Text(
                                    listOf(part.artist.joinToString(" / "), part.album)
                                        .filter { it.isNotBlank() }
                                        .joinToString(" · "),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body2,
            )
                            },
                            modifier = Modifier.clickable { viewModel.selectBilibiliCollection(part) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
}

@Composable
internal fun BilibiliMetadataDialog(
    match: BilibiliMetadataMatchState,
    viewModel: MusicTogetherViewModel,
) {
    val track = match.track ?: return
    var keyword by remember(track.id) { mutableStateOf(match.keyword) }
    AppDialog(
        onDismissRequest = viewModel::dismissBilibiliMetadata,
        title = "选择歌词和封面",
        confirmText = "直接播放视频",
        onConfirm = viewModel::skipBilibiliMetadata,
    ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    listOf(
                        "netease" to "网易云音乐",
                        "tencent" to "QQ 音乐",
                        "kugou" to "酷狗音乐",
                        "kugou_concept" to "酷狗概念版",
                    ).forEach { (source, label) ->
                        AppChip(
                            onClick = { viewModel.searchBilibiliMetadata(keyword, source) },
                            label = { Text(label) },
                            leadingIcon = if (match.source == source) {
                                { Icon(Icons.Default.MusicNote, null, Modifier.size(16.dp)) }
                            } else {
                                null
                            },
                        )
                    }
                }
                AppTextField(
                    value = keyword,
                    onValueChange = { keyword = it.take(100) },
                    modifier = Modifier.fillMaxWidth(),
                    label = "搜索歌曲或歌手",
                )
                AppButton(
                    text = "搜索",
                    onClick = { viewModel.searchBilibiliMetadata(keyword, match.source) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = keyword.isNotBlank(),
                )
                when {
                    match.loading -> Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    match.error != null -> Text(match.error, color = MiuixTheme.colorScheme.error)
                    match.results.isEmpty() -> Text(
                        "未找到匹配歌曲，可修改关键词或直接播放视频。",
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                    else -> LazyColumn(Modifier.fillMaxWidth().height(260.dp)) {
                        items(match.results, key = { it.id }) { metadataTrack ->
                            AppListItem(
                                headlineContent = { Text(metadataTrack.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                supportingContent = {
                                    Text(
                                        listOf(metadataTrack.artist.joinToString(" / "), metadataTrack.album)
                                            .filter { it.isNotBlank() }
                                            .joinToString(" · "),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                style = MiuixTheme.textStyles.body2,
            )
                                },
                                modifier = Modifier.clickable { viewModel.selectBilibiliMetadata(metadataTrack) },
                            )
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
}
