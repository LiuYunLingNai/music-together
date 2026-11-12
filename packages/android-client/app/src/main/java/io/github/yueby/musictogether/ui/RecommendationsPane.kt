package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Check
import com.composables.icons.lucide.CircleAlert
import com.composables.icons.lucide.RefreshCw
import com.composables.icons.lucide.Sparkles
import io.github.yueby.musictogether.ui.designsystem.AppTextAction
import io.github.yueby.musictogether.ui.designsystem.AppChip
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.queueIdentity

internal fun recommendationPlatforms(recommendations: List<PlatformRecommendation>): List<String> =
    recommendations.map { it.platform }.distinct()

internal fun recommendationShowsTracks(recommendation: PlatformRecommendation, tencentView: String): Boolean =
    recommendation.platform == "bilibili" ||
        (recommendation.platform == "tencent" && tencentView == "tracks") ||
        (recommendation.platform != "tencent" && recommendation.playlists.isEmpty() && recommendation.tracks.isNotEmpty())

@Composable
internal fun PersonalRecommendations(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val room = state.room ?: return
    val platforms = recommendationPlatforms(state.recommendations)
    var selectedPlatform by remember(room.id) { mutableStateOf<String?>(null) }
    val selectedRecommendation = state.recommendations.firstOrNull { it.platform == selectedPlatform }

    LaunchedEffect(room.id, state.recommendationsLoaded, state.recommendationsLoading) {
        if (!state.recommendationsLoaded && !state.recommendationsLoading) viewModel.loadRecommendations()
    }
    LaunchedEffect(platforms) {
        if (selectedPlatform !in platforms) selectedPlatform = platforms.firstOrNull()
    }

    Column(Modifier.fillMaxSize()) {
        when {
            state.recommendationsLoading && state.recommendations.isEmpty() -> RecommendationStatus(
                text = "正在加载推荐",
                loading = true,
            )
            state.recommendationsError != null && state.recommendations.isEmpty() -> RecommendationStatus(
                text = state.recommendationsError,
                action = viewModel::loadRecommendations,
            )
            state.recommendations.isEmpty() -> RecommendationStatus(
                text = "请先在音源账号中登录音乐平台，再查看平台推荐",
            )
            else -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 4.dp, top = 6.dp)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    platforms.forEach { platform ->
                        AppChip(
                            onClick = { selectedPlatform = platform },
                            label = { Text(platformLabel(platform)) },
                            leadingIcon = if (selectedPlatform == platform) {
                                { Icon(Lucide.Sparkles, null, Modifier.size(16.dp)) }
                            } else {
                                null
                            },
                        )
                    }
                    IconButton(
                        onClick = viewModel::loadRecommendations,
                        enabled = !state.recommendationsLoading && !state.recommendationsLoadingMore,
                    ) {
                        Icon(Lucide.RefreshCw, "刷新推荐")
                    }
                }
                RecommendationContent(selectedRecommendation, state, viewModel, contentPadding)
            }
        }
    }
}

@Composable
private fun RecommendationContent(
    recommendation: PlatformRecommendation?,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    contentPadding: PaddingValues,
) {
    if (recommendation == null) {
        RecommendationStatus(text = "暂无可用推荐")
        return
    }
    var tencentView by remember(recommendation.platform) { mutableStateOf("tracks") }
    Column(Modifier.fillMaxSize()) {
        if (recommendation.platform == "tencent") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AppChip(
                    onClick = { tencentView = "tracks" },
                    label = { Text("雷达歌曲") },
                    leadingIcon = if (tencentView == "tracks") {
                        { Icon(Lucide.Check, null, Modifier.size(16.dp)) }
                    } else {
                        null
                    },
                )
                AppChip(
                    onClick = { tencentView = "playlists" },
                    label = { Text("推荐歌单") },
                    leadingIcon = if (tencentView == "playlists") {
                        { Icon(Lucide.Check, null, Modifier.size(16.dp)) }
                    } else {
                        null
                    },
                )
            }
        }
        val showTracks = recommendationShowsTracks(recommendation, tencentView)
        Box(Modifier.weight(1f)) {
            if (showTracks) {
                RecommendationTrackList(
                    recommendation = recommendation,
                    state = state,
                    viewModel = viewModel,
                    canLoadMore = recommendation.platform == "tencent" &&
                        recommendation.pagination?.tracks?.hasMore == true,
                    contentPadding = contentPadding,
                )
            } else {
                RecommendationPlaylistList(
                    recommendation = recommendation,
                    state = state,
                    viewModel = viewModel,
                    canLoadMore = recommendation.platform == "tencent" &&
                        recommendation.pagination?.playlists?.hasMore == true,
                    contentPadding = contentPadding,
                )
            }
        }
    }
}

@Composable
private fun RecommendationTrackList(
    recommendation: PlatformRecommendation,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    canLoadMore: Boolean,
    contentPadding: PaddingValues,
) {
    val queueKeys = rememberQueueKeys(state)
    if (recommendation.tracks.isEmpty()) {
        RecommendationStatus(
            text = recommendationEmptyText(recommendation, "平台暂时没有返回推荐歌曲"),
            action = recommendationRetry(recommendation, viewModel),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 4.dp, bottom = 8.dp + contentPadding.calculateBottomPadding()),
    ) {
        items(recommendation.tracks, key = { it.queueIdentity() }) { track ->
            MusicTrackItem(track = track, state = state, viewModel = viewModel, queueKeys = queueKeys)
        }
        recommendationLoadMoreItem(canLoadMore, state, viewModel)
    }
}

@Composable
private fun RecommendationPlaylistList(
    recommendation: PlatformRecommendation,
    state: AppState,
    viewModel: MusicTogetherViewModel,
    canLoadMore: Boolean,
    contentPadding: PaddingValues,
) {
    val navigator = LocalAppNavigator.current
    if (recommendation.playlists.isEmpty()) {
        RecommendationStatus(
            text = recommendationEmptyText(recommendation, "平台暂时没有返回推荐歌单"),
            action = recommendationRetry(recommendation, viewModel),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 4.dp, bottom = 8.dp + contentPadding.calculateBottomPadding()),
    ) {
        items(recommendation.playlists, key = { "${it.source}:${it.id}" }) { playlist ->
            PlaylistRow(playlist) { navigator.openPlaylist(playlist) }
        }
        recommendationLoadMoreItem(canLoadMore, state, viewModel)
    }
}

private fun recommendationEmptyText(recommendation: PlatformRecommendation, fallback: String): String =
    if (recommendation.unavailableReason == "upstream_unavailable") {
        "平台推荐暂时不可用，请刷新重试"
    } else {
        fallback
    }

private fun recommendationRetry(
    recommendation: PlatformRecommendation,
    viewModel: MusicTogetherViewModel,
): (() -> Unit)? = if (recommendation.unavailableReason == "upstream_unavailable") {
    viewModel::loadRecommendations
} else {
    null
}

private fun LazyListScope.recommendationLoadMoreItem(
    canLoadMore: Boolean,
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    if (!canLoadMore) return
    item {
        AppTextAction(
            onClick = viewModel::loadMoreRecommendations,
            enabled = !state.recommendationsLoadingMore,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        ) {
            if (state.recommendationsLoadingMore) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else {
                Text(if (state.recommendationsError != null) "加载失败，点击重试" else "继续加载")
            }
        }
    }
}

@Composable
private fun RecommendationStatus(
    text: String,
    loading: Boolean = false,
    action: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
        } else {
            Icon(
                if (action == null) Lucide.Sparkles else Lucide.CircleAlert,
                contentDescription = null,
                modifier = Modifier.size(32.dp),
                tint = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        Text(
            text = text,
            modifier = Modifier.padding(top = 12.dp),
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            textAlign = TextAlign.Center,
        )
        action?.let {
            MiuixTextButton(text = "重试", onClick = it, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
