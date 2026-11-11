package io.github.yueby.musictogether.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.UnifiedSearchGroup
import io.github.yueby.musictogether.model.queueIdentity
import io.github.yueby.musictogether.ui.designsystem.AppButton

@Composable
internal fun UnifiedSearchResults(state: AppState, viewModel: MusicTogetherViewModel, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        if (state.unifiedSearchGroups.isEmpty()) item { Text("本次搜索未找到匹配歌曲。", Modifier.padding(12.dp)) }
        if (state.searchFailedSources.isNotEmpty()) {
            item {
                Text(
                    "部分平台暂时不可用：${state.searchFailedSources.joinToString("、", transform = ::platformLabel)}",
                    Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error,
                )
            }
        }
        itemsIndexed(state.unifiedSearchGroups, key = { index, group -> "$index:${group.key}" }) { _, group ->
            UnifiedSearchGroupRow(group, state, viewModel)
            HorizontalDivider()
        }
        item {
            Text("跨源搜索展示每个平台的前 10 条候选；更多结果可切换到单个平台搜索。", Modifier.padding(12.dp))
        }
    }
}

@Composable
private fun UnifiedSearchGroupRow(group: UnifiedSearchGroup, state: AppState, viewModel: MusicTogetherViewModel) {
    var selectedIndex by remember(group) { mutableIntStateOf(0) }
    val track = group.candidates.getOrNull(selectedIndex) ?: return
    val added = state.room?.queue?.any { it.queueIdentity() == track.queueIdentity() } == true
    val version = when (group.version) {
        "live" -> "现场"
        "remix" -> "混音"
        "instrumental" -> "伴奏 / 纯音乐"
        "cover" -> "翻唱"
        else -> group.version
    }
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(group.title + version?.let { " · $it" }.orEmpty(), style = MaterialTheme.typography.titleMedium)
        Text(group.artist.joinToString(" / "), style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            group.candidates.forEachIndexed { index, candidate ->
                AssistChip(
                    onClick = { selectedIndex = index },
                    label = { Text((if (index == selectedIndex) "✓ " else "") + platformLabel(candidate.source) + if (candidate.vip) " · VIP" else "") },
                )
            }
        }
        Text("已选：${platformLabel(track.source)} · ${track.album}", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppButton(if (added) "已在队列" else "点歌", { viewModel.addTrack(track) }, enabled = !added)
            AppButton("置顶到当前曲之后", { viewModel.insertAfterCurrent(track) }, enabled = !added, primary = false)
        }
    }
}
