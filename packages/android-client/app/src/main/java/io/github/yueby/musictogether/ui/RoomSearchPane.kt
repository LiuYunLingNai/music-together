package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.BilibiliMetadataMatchState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.network.searchInputMaxLength

@Composable
internal fun SearchPane(state: AppState, viewModel: MusicTogetherViewModel) {
    var keyword by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("netease") }
    val listState = rememberLazyListState()
    val shouldLoadMore by remember(
        listState,
        state.searchResults.size,
        state.searchHasMore,
        state.searchLoadingMore,
    ) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.searchHasMore && !state.searchLoadingMore &&
                state.searchResults.isNotEmpty() && lastVisible >= state.searchResults.lastIndex - 3
        }
    }
    LaunchedEffect(shouldLoadMore, state.searchResults.size) {
        if (shouldLoadMore) viewModel.loadMoreSearch()
    }
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("搜索并点歌", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(8.dp))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(
                "netease" to "网易云",
                "tencent" to "QQ 音乐",
                "kugou" to "酷狗",
                "kugou_concept" to "概念版",
                "bilibili" to "B站",
            ).forEach { (value, label) ->
                AssistChip(onClick = { source = value }, label = { Text(label) }, leadingIcon = if (source == value) {
                    { Icon(Icons.Default.MusicNote, null, Modifier.size(16.dp)) }
                } else null)
            }
        }
        OutlinedTextField(
            value = keyword,
            onValueChange = { keyword = it.take(searchInputMaxLength(source)) },
            modifier = Modifier.fillMaxWidth(),
            label = {
                Text(if (source == "bilibili") "视频关键词、B 站链接或 BV 号" else "歌曲、歌手或专辑")
            },
            singleLine = true,
            trailingIcon = {
                IconButton(onClick = { viewModel.search(keyword, source) }) { Icon(Icons.Default.Search, "搜索") }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { viewModel.search(keyword, source) }),
        )
        if (state.searchLoading) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (state.searchError != null && state.searchResults.isEmpty()) {
            Text(
                "搜索失败：${state.searchError}",
                modifier = Modifier.padding(20.dp),
                color = MaterialTheme.colorScheme.error,
            )
        } else if (state.searchHasSearched && state.searchResults.isEmpty()) {
            Text(
                if (state.searchSource == "bilibili") {
                    "未找到结果，请检查链接、BV 号或更换关键词。"
                } else {
                    "未找到结果，请尝试其他关键词或音乐源。"
                },
                Modifier.padding(20.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            LazyColumn(
                Modifier.weight(1f),
                state = listState,
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                items(state.searchResults, key = { it.id }) { track ->
                    val trackKey = track.queueIdentity()
                    val isAdded = state.room?.queue?.any { it.queueIdentity() == trackKey } == true
                    TrackRow(
                        track = track,
                        subtitle = "${track.artist.joinToString(" / ")} · ${track.album}",
                        primaryAction = null,
                        primaryIcon = Icons.AutoMirrored.Filled.PlaylistAdd,
                        onClick = if (isAdded) null else ({ viewModel.addTrack(track) }),
                        trailingContent = {
                            SearchTrackActions(
                                isAdded = isAdded,
                                onAdd = { viewModel.addTrack(track) },
                                onPin = { viewModel.insertAfterCurrent(track) },
                            )
                        },
                    )
                    HorizontalDivider()
                }
                if (state.searchLoadingMore) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                } else if (state.searchError != null) {
                    item {
                        Text(
                            "加载下一页失败：${state.searchError}",
                            modifier = Modifier.padding(20.dp),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                } else if (!state.searchHasMore && state.searchResults.isNotEmpty()) {
                    item {
                        Text(
                            "已经到底了",
                            modifier = Modifier.fillMaxWidth().padding(20.dp),
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
internal fun BilibiliMetadataDialog(
    match: BilibiliMetadataMatchState,
    viewModel: MusicTogetherViewModel,
) {
    val track = match.track ?: return
    var keyword by remember(track.id) { mutableStateOf(match.keyword) }
    AlertDialog(
        onDismissRequest = viewModel::dismissBilibiliMetadata,
        title = { Text("选择歌词和封面") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("netease" to "网易云音乐", "tencent" to "QQ 音乐").forEach { (source, label) ->
                        AssistChip(
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
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it.take(100) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("搜索歌曲或歌手") },
                    singleLine = true,
                    trailingIcon = {
                        IconButton(onClick = { viewModel.searchBilibiliMetadata(keyword, match.source) }) {
                            Icon(Icons.Default.Search, "搜索")
                        }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(
                        onSearch = { viewModel.searchBilibiliMetadata(keyword, match.source) },
                    ),
                )
                when {
                    match.loading -> Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    match.error != null -> Text(match.error, color = MaterialTheme.colorScheme.error)
                    match.results.isEmpty() -> Text(
                        "未找到匹配歌曲，可修改关键词或直接播放视频。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    else -> LazyColumn(Modifier.fillMaxWidth().height(260.dp)) {
                        items(match.results, key = { it.id }) { metadataTrack ->
                            ListItem(
                                headlineContent = { Text(metadataTrack.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                supportingContent = {
                                    Text(
                                        listOf(metadataTrack.artist.joinToString(" / "), metadataTrack.album)
                                            .filter { it.isNotBlank() }
                                            .joinToString(" · "),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                },
                                modifier = Modifier.clickable { viewModel.selectBilibiliMetadata(metadataTrack) },
                            )
                            HorizontalDivider()
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = viewModel::skipBilibiliMetadata) { Text("直接播放视频") }
        },
        dismissButton = {
            TextButton(onClick = viewModel::dismissBilibiliMetadata) { Text("取消") }
        },
    )
}

@Composable
private fun SearchTrackActions(isAdded: Boolean, onAdd: () -> Unit, onPin: () -> Unit) {
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
}
