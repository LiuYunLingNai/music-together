package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ArrowLeft
import com.composables.icons.lucide.CloudOff
import com.composables.icons.lucide.Search
import com.composables.icons.lucide.SearchX
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.network.searchInputMaxLength
import io.github.yueby.musictogether.ui.designsystem.AppEmptyState
import io.github.yueby.musictogether.ui.designsystem.AppLoadingState
import io.github.yueby.musictogether.ui.designsystem.AppTabPage
import io.github.yueby.musictogether.ui.designsystem.LocalAppPageBackground
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.InputField
import top.yukonga.miuix.kmp.basic.TabRow
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

private val searchSources = listOf(
    "all" to "全部",
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
    "kugou_concept" to "概念版",
    "bilibili" to "B站",
)

@Composable
internal fun DiscoverTab(state: AppState, viewModel: MusicTogetherViewModel, bottomPadding: Dp) {
    val navigator = LocalAppNavigator.current
    val catalog by viewModel.catalogState.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val inRoom = state.room != null
    val connected = state.connectionStatus == ConnectionStatus.Connected

    AppTabPage(title = "发现", bottomPadding = bottomPadding) { padding ->
        Column(Modifier.fillMaxSize()) {
            SearchEntry(
                onClick = { navigator.open(AppRoute.Search) },
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
            if (inRoom) {
                TabRow(
                    tabs = listOf("发现", "为你推荐"),
                    selectedTabIndex = tab,
                    onTabSelected = { tab = it },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
            Box(Modifier.weight(1f)) {
                when {
                    !connected && catalog.discover.home == null -> AppEmptyState(
                        icon = Lucide.CloudOff,
                        title = "连接服务器后浏览",
                        summary = "发现页与搜索需要连接 Music Together 服务器",
                        actionText = "服务器设置",
                        onAction = { navigator.open(AppRoute.Server) },
                    )
                    inRoom && tab == 1 -> PersonalRecommendations(state, viewModel, padding)
                    else -> DiscoverPane(viewModel, padding)
                }
            }
        }
    }
}

@Composable
private fun SearchEntry(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(45.dp)
            .clip(CircleShape)
            .background(MiuixTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Lucide.Search, null, Modifier.size(20.dp), tint = MiuixTheme.colorScheme.onSurfaceContainerHigh)
        Text("搜索歌曲、歌手、专辑或 B 站视频", color = MiuixTheme.colorScheme.onSurfaceContainerHigh)
    }
}

@Composable
internal fun SearchScreen(state: AppState, viewModel: MusicTogetherViewModel, onBack: () -> Unit) {
    var keyword by rememberSaveable { mutableStateOf(state.searchKeyword) }
    var source by rememberSaveable { mutableStateOf(state.searchSource) }
    var focused by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val queueKeys = rememberQueueKeys(state)
    val listState = rememberLazyListState()
    val connected = state.connectionStatus == ConnectionStatus.Connected
    val submit: (String) -> Unit = { query ->
        if (query.isNotBlank()) {
            focusManager.clearFocus()
            viewModel.search(query, source)
        }
    }
    val shouldLoadMore by remember(listState, state.searchResults.size, state.searchHasMore, state.searchLoadingMore) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.searchHasMore && !state.searchLoadingMore &&
                state.searchResults.isNotEmpty() && lastVisible >= state.searchResults.lastIndex - 3
        }
    }
    LaunchedEffect(shouldLoadMore, state.searchResults.size) {
        if (shouldLoadMore) viewModel.loadMoreSearch()
    }
    LaunchedEffect(Unit) {
        if (!state.searchHasSearched) focusRequester.requestFocus()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(LocalAppPageBackground.current)
            .statusBarsPadding()
            .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime).only(WindowInsetsSides.Bottom)),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Lucide.ArrowLeft, "返回") }
            InputField(
                query = keyword,
                onQueryChange = { keyword = it.take(searchInputMaxLength(source)) },
                onSearch = submit,
                expanded = focused,
                onExpandedChange = { focused = it },
                label = if (source == "bilibili") "视频关键词、链接或 BV 号" else "歌曲、歌手或专辑",
                modifier = Modifier.weight(1f).focusRequester(focusRequester),
            )
        }
        TabRow(
            tabs = searchSources.map { it.second },
            selectedTabIndex = searchSources.indexOfFirst { it.first == source }.coerceAtLeast(0),
            onTabSelected = { index ->
                source = searchSources[index].first
                if (keyword.isNotBlank() && state.searchHasSearched) submit(keyword)
            },
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
        Box(Modifier.weight(1f)) {
            when {
                !connected -> AppEmptyState(Lucide.CloudOff, "服务器未连接", summary = "连接服务器后才能搜索")
                state.searchLoading -> AppLoadingState()
                state.searchError != null && state.searchResults.isEmpty() && state.unifiedSearchGroups.isEmpty() ->
                    AppEmptyState(
                        Lucide.SearchX,
                        "搜索失败",
                        summary = state.searchError,
                        actionText = "重试",
                        onAction = { submit(keyword) },
                    )
                !state.searchHasSearched -> AppEmptyState(
                    Lucide.Search,
                    "搜索全网音乐",
                    summary = if (state.room != null) "点结果直接点歌，长列表可继续上滑加载" else "加入房间后可点歌，现在可以下载或收藏到歌单",
                )
                state.searchSource == "all" -> UnifiedSearchResults(state, viewModel, queueKeys, Modifier.fillMaxSize())
                state.searchResults.isEmpty() -> AppEmptyState(
                    Lucide.SearchX,
                    "没有找到结果",
                    summary = if (state.searchSource == "bilibili") "检查链接、BV 号或换个关键词" else "换个关键词或音源试试",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().overScrollVertical(),
                    state = listState,
                    contentPadding = PaddingValues(bottom = 16.dp),
                ) {
                    items(state.searchResults, key = { "${it.source}:${it.id}" }) { track ->
                        MusicTrackItem(track, state, viewModel, queueKeys, multiLine = true)
                    }
                    item(key = "footer") {
                        when {
                            state.searchLoadingMore -> Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                            }
                            state.searchError != null -> Text(
                                "加载下一页失败：${state.searchError}",
                                modifier = Modifier.fillMaxWidth().padding(20.dp),
                                textAlign = TextAlign.Center,
                                color = MiuixTheme.colorScheme.error,
                            )
                            !state.searchHasMore -> Text(
                                "已经到底了",
                                modifier = Modifier.fillMaxWidth().padding(20.dp),
                                textAlign = TextAlign.Center,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                }
            }
        }
    }
}
