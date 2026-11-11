package io.github.yueby.musictogether.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
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
import io.github.yueby.musictogether.ui.designsystem.AppChip
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun UnifiedSearchResults(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    queueKeys: Set<String>,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier.overScrollVertical(), contentPadding = PaddingValues(bottom = 16.dp)) {
        if (state.searchFailedSources.isNotEmpty()) {
            item(key = "failed") {
                Text(
                    "部分平台暂时不可用：${state.searchFailedSources.joinToString("、", transform = ::platformLabel)}",
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.error,
                )
            }
        }
        if (state.unifiedSearchGroups.isEmpty()) {
            item(key = "empty") {
                Text(
                    "本次搜索未找到匹配歌曲",
                    Modifier.padding(16.dp),
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                )
            }
        }
        itemsIndexed(state.unifiedSearchGroups, key = { index, group -> "$index:${group.key}" }) { _, group ->
            UnifiedSearchGroupRow(group, state, viewModel, queueKeys)
        }
        item(key = "hint") {
            Text(
                "跨源搜索每个平台展示前 10 条候选，切换到单个平台可查看更多结果",
                Modifier.padding(16.dp),
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
    }
}

@Composable
private fun UnifiedSearchGroupRow(
    group: UnifiedSearchGroup,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    queueKeys: Set<String>,
) {
    var selectedIndex by remember(group) { mutableIntStateOf(0) }
    val track = group.candidates.getOrNull(selectedIndex) ?: return
    val version = when (group.version) {
        "live" -> "现场"
        "remix" -> "混音"
        "instrumental" -> "伴奏"
        "cover" -> "翻唱"
        else -> group.version
    }
    Column(Modifier.fillMaxWidth()) {
        MusicTrackItem(track = track, state = state, viewModel = viewModel, queueKeys = queueKeys)
        if (group.candidates.size > 1 || version != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(start = 76.dp, end = 16.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                version?.let { Text(it, style = MiuixTheme.textStyles.footnote1, color = MiuixTheme.colorScheme.primary) }
                if (group.candidates.size > 1) {
                    group.candidates.forEachIndexed { index, candidate ->
                        AppChip(
                            onClick = { selectedIndex = index },
                            selected = index == selectedIndex,
                            label = { Text(platformLabel(candidate.source) + if (candidate.vip) " · VIP" else "") },
                        )
                    }
                }
            }
        }
    }
}
