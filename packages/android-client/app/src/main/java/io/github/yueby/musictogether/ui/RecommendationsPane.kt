package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.PlatformRecommendation
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.queueIdentity

internal fun recommendationPlatforms(recommendations: List<PlatformRecommendation>): List<String> =
    recommendations.map { it.platform }.distinct()

internal fun recommendationShowsTracks(recommendation: PlatformRecommendation, tencentView: String): Boolean =
    recommendation.platform == "bilibili" ||
        (recommendation.platform == "tencent" && tencentView == "tracks") ||
        (recommendation.platform != "tencent" && recommendation.playlists.isEmpty() && recommendation.tracks.isNotEmpty())

@Composable
internal fun RecommendationsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val room = state.room ?: return
    state.platformHub.selectedPlaylist?.let { playlist ->
        PlaylistDetailPane(state, playlist, viewModel)
        return
    }
    val platforms = recommendationPlatforms(state.recommendations)
    var selectedPlatform by remember(room.id) { mutableStateOf<String?>(null) }
    val selectedRecommendation = state.recommendations.firstOrNull { it.platform == selectedPlatform }

    LaunchedEffect(room.id, state.recommendationsLoaded, state.recommendationsLoading) {
        if (!state.recommendationsLoaded && !state.recommendationsLoading) viewModel.loadRecommendations()
    }
    LaunchedEffect(platforms) {
        if (selectedPlatform !in platforms) selectedPlatform = platforms.firstOrNull()
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        RecommendationPaneHeader(state, viewModel)

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
                        .padding(top = 10.dp)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    platforms.forEach { platform ->
                        AssistChip(
                            onClick = { selectedPlatform = platform },
                            label = { Text(platformLabel(platform)) },
                            leadingIcon = if (selectedPlatform == platform) {
                                { Icon(Icons.Default.AutoAwesome, null, Modifier.size(16.dp)) }
                            } else {
                                null
                            },
                        )
                    }
                }
                RecommendationContent(selectedRecommendation, state, viewModel)
            }
        }
    }
}

@Composable
internal fun LobbyRecommendationsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val room = state.room ?: return
    state.platformHub.selectedPlaylist?.let { playlist ->
        PlaylistDetailPane(state, playlist, viewModel)
        return
    }
    LaunchedEffect(room.id, state.recommendationsLoaded, state.recommendationsLoading) {
        if (!state.recommendationsLoaded && !state.recommendationsLoading) viewModel.loadRecommendations()
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        RecommendationPaneHeader(state, viewModel)

        Box(Modifier.weight(1f)) {
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
                else -> RecommendationsFeedPane(
                    recommendations = state.recommendations,
                    state = state,
                    viewModel = viewModel,
                )
            }
        }
    }
}

@Composable
private fun RecommendationPaneHeader(state: AppState, viewModel: MusicTogetherViewModel) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("推荐点歌", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "展示当前账号在平台上的原生推荐内容",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            onClick = viewModel::loadRecommendations,
            enabled = !state.recommendationsLoading && !state.recommendationsLoadingMore,
        ) {
            Icon(Icons.Default.Refresh, "刷新推荐")
        }
    }
}

@Composable
private fun RecommendationsFeedPane(
    recommendations: List<PlatformRecommendation>,
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    val playlists = recommendations
        .flatMap { it.playlists }
        .distinctBy { "${it.source}:${it.id}" }
    val tracks = recommendations
        .flatMap { it.tracks }
        .distinctBy { it.queueIdentity() }
    val canLoadMore = (
        recommendations
            .firstOrNull { it.platform == "tencent" }
            ?.pagination
            ?.let { it.tracks?.hasMore == true || it.playlists?.hasMore == true }
            == true
        )

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val playlistColumns = (maxWidth / 176.dp).toInt().coerceAtLeast(2)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 4.dp, end = 4.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
        if (playlists.isNotEmpty()) {
            item { RecommendationFeedSectionTitle("热门推荐", Icons.Default.AutoAwesome) }
            items(
                playlists.chunked(playlistColumns),
                key = { row -> row.joinToString("|") { "${it.source}:${it.id}" } },
            ) { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    row.forEach { playlist ->
                        RecommendationPlaylistCard(
                            playlist = playlist,
                            onClick = { viewModel.openPlaylist(playlist) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(playlistColumns - row.size) {
                        Spacer(Modifier.weight(1f, fill = false))
                    }
                }
            }
        }
        if (tracks.isNotEmpty()) {
            item { RecommendationFeedSectionTitle("为你推荐", Icons.Default.MusicNote) }
            itemsIndexed(tracks, key = { _, track -> track.queueIdentity() }) { index, track ->
                RecommendationFeedTrackRow(
                    rank = index + 1,
                    track = track,
                    state = state,
                    viewModel = viewModel,
                )
            }
        }
        recommendationLoadMoreItem(canLoadMore, state, viewModel)
        }
    }
}

@Composable
private fun RecommendationFeedSectionTitle(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(23.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun RecommendationPlaylistCard(
    playlist: Playlist,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(15.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.78f),
        ),
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f),
            ) {
                AsyncImage(
                    model = playlist.cover,
                    contentDescription = playlist.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
                TrackPlatformBadge(
                    source = playlist.source,
                    compact = false,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(6.dp),
                )
            }
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                Text(
                    text = playlist.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = buildString {
                        append(playlist.trackCount)
                        append(" 首")
                        playlist.creator?.let { append(" · ").append(it) }
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun RecommendationFeedTrackRow(
    rank: Int,
    track: Track,
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    val isAdded = state.room?.queue?.any { it.queueIdentity() == track.queueIdentity() } == true
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = rank.toString(),
            modifier = Modifier.width(28.dp),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TrackCover(
            track = track,
            size = 52.dp,
            cornerRadius = 9.dp,
            contentDescription = track.title,
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 11.dp),
        ) {
            Text(
                text = track.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${track.artist.joinToString(" / ")} · ${track.album}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = { viewModel.addTrack(track) }, enabled = !isAdded) {
            Icon(
                imageVector = if (isAdded) Icons.Default.Check else Icons.AutoMirrored.Filled.PlaylistAdd,
                contentDescription = if (isAdded) "已加入" else "添加到播放队列",
                tint = if (isAdded) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!isAdded) {
            IconButton(onClick = { viewModel.insertAfterCurrent(track) }) {
                Icon(
                    imageVector = Icons.Default.VerticalAlignTop,
                    contentDescription = "置顶到当前播放下方",
                )
            }
        }
    }
}

@Composable
private fun RecommendationContent(
    recommendation: PlatformRecommendation?,
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    if (recommendation == null) {
        RecommendationStatus(text = "暂无可用推荐")
        return
    }
    var tencentView by remember(recommendation.platform) { mutableStateOf("tracks") }
    Column(Modifier.fillMaxSize()) {
        if (recommendation.platform == "tencent") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AssistChip(
                    onClick = { tencentView = "tracks" },
                    label = { Text("雷达歌曲") },
                    leadingIcon = if (tencentView == "tracks") {
                        { Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }
                    } else {
                        null
                    },
                )
                AssistChip(
                    onClick = { tencentView = "playlists" },
                    label = { Text("推荐歌单") },
                    leadingIcon = if (tencentView == "playlists") {
                        { Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }
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
                )
            } else {
                RecommendationPlaylistList(
                    recommendation = recommendation,
                    state = state,
                    viewModel = viewModel,
                    canLoadMore = recommendation.platform == "tencent" &&
                        recommendation.pagination?.playlists?.hasMore == true,
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
) {
    if (recommendation.tracks.isEmpty()) {
        RecommendationStatus(
            text = recommendationEmptyText(recommendation, "平台暂时没有返回推荐歌曲"),
            action = recommendationRetry(recommendation, viewModel),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(recommendation.tracks, key = { it.queueIdentity() }) { track ->
            val isAdded = state.room?.queue?.any { it.queueIdentity() == track.queueIdentity() } == true
            TrackRow(
                track = track,
                subtitle = "${track.artist.joinToString(" / ")} · ${track.album}",
                primaryAction = null,
                primaryIcon = Icons.AutoMirrored.Filled.PlaylistAdd,
                onClick = if (isAdded) null else ({ viewModel.addTrack(track) }),
                trailingContent = {
                    RecommendationTrackActions(
                        isAdded = isAdded,
                        onAdd = { viewModel.addTrack(track) },
                        onPin = { viewModel.insertAfterCurrent(track) },
                    )
                },
            )
            HorizontalDivider()
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
) {
    if (recommendation.playlists.isEmpty()) {
        RecommendationStatus(
            text = recommendationEmptyText(recommendation, "平台暂时没有返回推荐歌单"),
            action = recommendationRetry(recommendation, viewModel),
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(recommendation.playlists, key = { "${it.source}:${it.id}" }) { playlist ->
            PlaylistRow(playlist) { viewModel.openPlaylist(playlist) }
            HorizontalDivider()
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
        TextButton(
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
private fun RecommendationTrackActions(isAdded: Boolean, onAdd: () -> Unit, onPin: () -> Unit) {
    Row {
        IconButton(onClick = onAdd, enabled = !isAdded) {
            Icon(
                if (isAdded) Icons.Default.Check else Icons.AutoMirrored.Filled.PlaylistAdd,
                if (isAdded) "已加入" else "添加到播放队列",
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
                if (action == null) Icons.Default.AutoAwesome else Icons.Default.ErrorOutline,
                contentDescription = null,
                modifier = Modifier.size(32.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = text,
            modifier = Modifier.padding(top = 12.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        action?.let {
            TextButton(onClick = it, modifier = Modifier.padding(top = 4.dp)) { Text("重试") }
        }
    }
}
