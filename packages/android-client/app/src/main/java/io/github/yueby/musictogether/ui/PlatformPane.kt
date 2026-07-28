package io.github.yueby.musictogether.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.MyPlatformAuth
import io.github.yueby.musictogether.model.PlatformAuthStatus
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.QrLoginState
import io.github.yueby.musictogether.model.Track

private val platformOptions = listOf(
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
)

@Composable
fun PlatformPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val selected = state.platformHub.selectedPlaylist

    LaunchedEffect(Unit) {
        viewModel.requestPlatformStatus()
    }

    if (selected == null) {
        PlatformAccountList(state, viewModel)
    } else {
        PlaylistDetailPane(state, selected, viewModel)
    }

    if (state.platformHub.qr.open) {
        QrLoginDialog(state.platformHub.qr, viewModel)
    }
}

@Composable
private fun PlatformAccountList(state: AppState, viewModel: MusicTogetherViewModel) {
    var platform by remember { mutableStateOf("netease") }
    var cookieDialogOpen by remember { mutableStateOf(false) }
    var cookieText by remember { mutableStateOf("") }
    val hub = state.platformHub
    val myAuth = hub.myAuth.firstOrNull { it.platform == platform }
    val roomAuth = hub.authStatus.firstOrNull { it.platform == platform }
    val playlists = hub.playlists[platform].orEmpty()
    val loading = platform in hub.playlistsLoading

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        Text(
            "平台账号 & 歌单",
            modifier = Modifier.padding(start = 8.dp, top = 12.dp),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "登录后可浏览个人歌单，平台账号也会为房间提供 VIP 播放能力。",
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            platformOptions.forEach { (value, label) ->
                AssistChip(
                    onClick = { platform = value },
                    label = { Text(label) },
                    leadingIcon = if (platform == value) {
                        { Icon(Icons.Default.LibraryMusic, null, Modifier.size(16.dp)) }
                    } else null,
                )
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                PlatformLoginCard(
                    platform = platform,
                    myAuth = myAuth,
                    roomAuth = roomAuth,
                    statusLoaded = hub.statusLoaded,
                    onQrLogin = { viewModel.requestQrLogin(platform) },
                    onCookieLogin = {
                        cookieText = ""
                        cookieDialogOpen = true
                    },
                    onLogout = { viewModel.logoutPlatform(platform) },
                )
            }

            if (myAuth?.loggedIn == true) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("我的歌单", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { viewModel.fetchMyPlaylists(platform) }, enabled = !loading) {
                            if (loading) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
                            }
                            Spacer(Modifier.width(4.dp))
                            Text("刷新")
                        }
                    }
                }
                if (loading && playlists.isEmpty()) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                } else if (playlists.isEmpty()) {
                    item {
                        Text(
                            "暂无歌单",
                            Modifier.fillMaxWidth().padding(32.dp),
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(playlists, key = { "${it.source}:${it.id}" }) { playlist ->
                        PlaylistRow(playlist) { viewModel.openPlaylist(playlist) }
                    }
                }
            } else {
                item {
                    Text(
                        if (hub.statusLoaded) "登录后即可查看这个平台的个人歌单" else "正在获取登录状态…",
                        Modifier.fillMaxWidth().padding(32.dp),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    if (cookieDialogOpen) {
        AlertDialog(
            onDismissRequest = { cookieDialogOpen = false },
            title = { Text("${platformLabel(platform)} Cookie 登录") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Cookie 只会按当前服务端 URL 单独保存在本机，不会写入日志。")
                    OutlinedTextField(
                        value = cookieText,
                        onValueChange = { cookieText = it.take(8000) },
                        modifier = Modifier.fillMaxWidth().height(150.dp),
                        placeholder = { Text("粘贴平台 Cookie") },
                        maxLines = 8,
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.loginWithPlatformCookie(platform, cookieText)
                        cookieText = ""
                        cookieDialogOpen = false
                    },
                    enabled = cookieText.isNotBlank(),
                ) { Text("登录") }
            },
            dismissButton = { TextButton(onClick = { cookieDialogOpen = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun PlatformLoginCard(
    platform: String,
    myAuth: MyPlatformAuth?,
    roomAuth: PlatformAuthStatus?,
    statusLoaded: Boolean,
    onQrLogin: () -> Unit,
    onCookieLogin: () -> Unit,
    onLogout: () -> Unit,
) {
    val loggedIn = myAuth?.loggedIn == true
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            loggedIn -> myAuth?.nickname ?: "已登录"
                            !statusLoaded -> "验证登录中…"
                            else -> "未登录"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        if ((roomAuth?.loggedInCount ?: 0) > 0) {
                            "房间内 ${roomAuth?.loggedInCount} 人已登录${if (roomAuth?.hasVip == true) "，VIP 可用" else ""}"
                        } else {
                            "房间暂无人登录${platformLabel(platform)}"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (roomAuth?.hasVip == true) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Star, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(4.dp))
                        Text(vipLabel(roomAuth.maxVipType), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            if (loggedIn) {
                OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null)
                    Spacer(Modifier.width(6.dp))
                    Text("退出登录")
                }
            } else if (statusLoaded) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(onClick = onQrLogin, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.QrCodeScanner, null)
                        Spacer(Modifier.width(6.dp))
                        Text("扫码登录")
                    }
                    OutlinedButton(onClick = onCookieLogin, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Key, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Cookie")
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaylistRow(playlist: Playlist, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick),
        leadingContent = {
            AsyncImage(
                model = playlist.cover,
                contentDescription = playlist.name,
                modifier = Modifier.size(54.dp).clip(RoundedCornerShape(9.dp)),
                contentScale = ContentScale.Crop,
            )
        },
        headlineContent = { Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                "${playlist.trackCount} 首${playlist.creator?.let { " · $it" }.orEmpty()}",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

@Composable
private fun PlaylistDetailPane(state: AppState, playlist: Playlist, viewModel: MusicTogetherViewModel) {
    val hub = state.platformHub
    val listState = rememberLazyListState()
    val queueIds = state.room?.queue.orEmpty().mapTo(hashSetOf()) { it.id }
    val availableCount = (1000 - (state.room?.queue?.size ?: 0)).coerceAtLeast(0)
    val addableCount = hub.playlistTracks.count { it.id !in queueIds }.coerceAtMost(availableCount)
    val shouldLoadMore by remember(
        listState,
        hub.playlistTracks.size,
        hub.playlistHasMore,
        hub.playlistLoadingMore,
    ) {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            hub.playlistHasMore && !hub.playlistLoadingMore &&
                hub.playlistTracks.isNotEmpty() && lastVisible >= hub.playlistTracks.lastIndex - 3
        }
    }
    LaunchedEffect(shouldLoadMore, hub.playlistTracks.size) {
        if (shouldLoadMore) viewModel.loadMorePlaylistTracks()
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 8.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = viewModel::closePlaylist) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回歌单列表")
            }
            Column(Modifier.weight(1f)) {
                Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                Text(
                    if (hub.playlistLoading) "加载中…" else "${hub.playlistTotal} 首 · 已加载 ${hub.playlistTracks.size}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            FilledTonalButton(
                onClick = { viewModel.addPlaylistTracksToQueue(playlist) },
                enabled = !hub.playlistLoading && addableCount > 0,
            ) {
                Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null, Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(if (addableCount > 0) "添加 $addableCount 首" else "已添加")
            }
        }
        HorizontalDivider()
        when {
            hub.playlistLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            hub.playlistError != null && hub.playlistTracks.isEmpty() -> Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(hub.playlistError, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { viewModel.openPlaylist(playlist) }) { Text("重试") }
            }
            hub.playlistTracks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("歌单为空", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(start = 0.dp, top = 6.dp, end = 0.dp, bottom = 20.dp),
            ) {
                items(hub.playlistTracks, key = { "${it.source}:${it.id}" }) { track ->
                    PlatformTrackRow(
                        track = track,
                        isAdded = track.id in queueIds,
                        onAdd = { viewModel.addTrack(track) },
                        onPin = { viewModel.insertAfterCurrent(track) },
                    )
                    HorizontalDivider()
                }
                if (hub.playlistLoadingMore) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                } else if (hub.playlistError != null) {
                    item {
                        TextButton(
                            onClick = viewModel::loadMorePlaylistTracks,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("加载失败，点击重试") }
                    }
                } else if (!hub.playlistHasMore) {
                    item {
                        Text(
                            "已经到底了",
                            Modifier.fillMaxWidth().padding(18.dp),
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
private fun PlatformTrackRow(track: Track, isAdded: Boolean, onAdd: () -> Unit, onPin: () -> Unit) {
    ListItem(
        modifier = if (isAdded) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().clickable(onClick = onAdd),
        colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
        leadingContent = {
            AsyncImage(
                model = rememberCoverImageRequest(track.cover),
                contentDescription = null,
                modifier = Modifier.size(50.dp).clip(RoundedCornerShape(8.dp)),
                contentScale = ContentScale.Crop,
            )
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(
                "${track.artist.joinToString(" / ")} · ${track.album}",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        trailingContent = {
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
        },
    )
}

@Composable
private fun QrLoginDialog(qr: QrLoginState, viewModel: MusicTogetherViewModel) {
    val bitmap = remember(qr.imageData) { qr.imageData?.let(::decodeDataImage) }
    val statusText = when (qr.status) {
        800 -> "二维码已过期"
        801 -> "等待扫码"
        802 -> "已扫码，请在手机上确认"
        803 -> "登录成功"
        else -> qr.message ?: if (qr.loading) "正在生成二维码…" else "二维码生成失败"
    }
    AlertDialog(
        onDismissRequest = viewModel::closeQrLogin,
        title = { Text("${platformLabel(qr.platform)}扫码登录") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    if (qr.platform == "tencent") "使用手机 QQ 扫描二维码" else "使用${platformLabel(qr.platform)} App 扫描二维码",
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    Modifier.size(240.dp).clip(RoundedCornerShape(12.dp)).background(androidx.compose.ui.graphics.Color.White),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        qr.loading -> CircularProgressIndicator()
                        bitmap != null -> Image(
                            bitmap = bitmap,
                            contentDescription = "登录二维码",
                            modifier = Modifier.fillMaxSize().padding(8.dp),
                        )
                        !qr.imageData.isNullOrBlank() -> AsyncImage(
                            model = qr.imageData,
                            contentDescription = "登录二维码",
                            modifier = Modifier.fillMaxSize().padding(8.dp),
                            contentScale = ContentScale.Fit,
                        )
                        else -> Text("二维码生成失败", color = androidx.compose.ui.graphics.Color.DarkGray)
                    }
                }
                Text(
                    statusText,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = if (qr.status == 800) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        },
        confirmButton = {
            if (qr.status == 800 || (!qr.loading && qr.imageData == null)) {
                Button(onClick = { viewModel.requestQrLogin(qr.platform) }) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(4.dp))
                    Text("重新获取")
                }
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeQrLogin) { Text("关闭") } },
    )
}

private fun decodeDataImage(value: String): androidx.compose.ui.graphics.ImageBitmap? = runCatching {
    val encoded = value.substringAfter("base64,", "")
    if (encoded.isBlank()) return@runCatching null
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

private fun platformLabel(platform: String): String = when (platform) {
    "netease" -> "网易云音乐"
    "tencent" -> "QQ 音乐"
    "kugou" -> "酷狗音乐"
    else -> platform
}

private fun vipLabel(type: Int): String = when (type) {
    10, 11 -> "黑胶 VIP"
    2 -> "豪华 VIP"
    3 -> "超级 VIP"
    else -> "VIP"
}
