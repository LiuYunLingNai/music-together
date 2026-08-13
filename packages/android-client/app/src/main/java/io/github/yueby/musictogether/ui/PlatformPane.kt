package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.MyPlatformAuth
import io.github.yueby.musictogether.model.Playlist
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.LocalAppWindowSheet
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.SmallTitle as MiuixSmallTitle
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

private val platformOptions = listOf(
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
    "bilibili" to "B站",
)

@Composable
fun PlatformPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val selected = state.platformHub.selectedPlaylist
    BackHandler(enabled = selected != null) { viewModel.closePlaylist() }

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
    var cookiePlatform by remember { mutableStateOf("netease") }
    var cookieText by remember { mutableStateOf("") }
    val hub = state.platformHub
    val myAuth = hub.myAuth.firstOrNull { it.platform == platform }
    val roomAuth = hub.authStatus.firstOrNull { it.platform == platform }
    val conceptAuth = hub.myAuth.firstOrNull { it.platform == "kugou_concept" }
    val conceptRoomAuth = hub.authStatus.firstOrNull { it.platform == "kugou_concept" }

    fun openCookieLogin(targetPlatform: String) {
        cookiePlatform = targetPlatform
        cookieText = ""
        cookieDialogOpen = true
    }

    val horizontalPadding = if (LocalAppWindowSheet.current) 0.dp else 12.dp
    Column(Modifier.fillMaxSize().padding(horizontal = horizontalPadding)) {
        if (LocalUiStyle.current == UiStyle.Miuix) {
            if (!LocalAppWindowSheet.current) {
                MiuixSmallTitle(text = "平台账号与歌单")
            }
            MiuixText(
                "登录后可浏览个人歌单，并为房间提供 VIP 播放能力。",
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                style = MiuixTheme.textStyles.footnote1,
            )
            MiuixCard(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                WindowDropdownPreference(
                    title = "音乐平台",
                    items = platformOptions.map { it.second },
                    selectedIndex = platformOptions.indexOfFirst { it.first == platform }.coerceAtLeast(0),
                    onSelectedIndexChange = { index -> platformOptions.getOrNull(index)?.let { platform = it.first } },
                )
            }
        } else {
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
                    onCookieLogin = { openCookieLogin(platform) },
                    onLogout = { viewModel.logoutPlatform(platform) },
                    compactLabel = if (platform == "kugou") "标准版" else null,
                    onClaimConceptVip = null,
                    isClaimingConceptVip = hub.claimingKugouConceptVip,
                )
            }

            if (platform == "kugou") {
                item {
                    PlatformLoginCard(
                        platform = "kugou_concept",
                        myAuth = conceptAuth,
                        roomAuth = conceptRoomAuth,
                        statusLoaded = hub.statusLoaded,
                        onQrLogin = { viewModel.requestQrLogin("kugou_concept") },
                        onCookieLogin = { openCookieLogin("kugou_concept") },
                        onLogout = { viewModel.logoutPlatform("kugou_concept") },
                        compactLabel = "概念版",
                        onClaimConceptVip = viewModel::claimKugouConceptVip,
                        isClaimingConceptVip = hub.claimingKugouConceptVip,
                    )
                }
            }

            platformPlaylistItems(
                platform = platform,
                auth = myAuth,
                statusLoaded = hub.statusLoaded,
                playlists = hub.playlists[platform].orEmpty(),
                loading = platform in hub.playlistsLoading,
                title = "我的${platformCollectionLabel(platform)}",
                showLoggedOutHint = true,
                viewModel = viewModel,
            )

            if (platform == "kugou" && conceptAuth?.loggedIn == true) {
                item { HorizontalDivider(Modifier.padding(vertical = 4.dp)) }
                platformPlaylistItems(
                    platform = "kugou_concept",
                    auth = conceptAuth,
                    statusLoaded = hub.statusLoaded,
                    playlists = hub.playlists["kugou_concept"].orEmpty(),
                    loading = "kugou_concept" in hub.playlistsLoading,
                    title = "概念版歌单",
                    showLoggedOutHint = false,
                    viewModel = viewModel,
                )
            }
        }
    }

    if (cookieDialogOpen) {
        AppDialog(
            onDismissRequest = { cookieDialogOpen = false },
            title = "${platformLabel(cookiePlatform)} Cookie 登录",
            confirmText = "登录",
            onConfirm = {
                viewModel.loginWithPlatformCookie(cookiePlatform, cookieText)
                cookieText = ""
                cookieDialogOpen = false
            },
            confirmEnabled = cookieText.isNotBlank(),
        ) {
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
        }
    }
}

private fun LazyListScope.platformPlaylistItems(
    platform: String,
    auth: MyPlatformAuth?,
    statusLoaded: Boolean,
    playlists: List<Playlist>,
    loading: Boolean,
    title: String,
    showLoggedOutHint: Boolean,
    viewModel: MusicTogetherViewModel,
) {
    if (auth?.loggedIn == true) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
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
        when {
            loading && playlists.isEmpty() -> item {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            playlists.isEmpty() -> item {
                Text(
                    "暂无${platformCollectionLabel(platform)}",
                    Modifier.fillMaxWidth().padding(32.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> items(playlists, key = { "${it.source}:${it.id}" }) { playlist ->
                PlaylistRow(playlist) { viewModel.openPlaylist(playlist) }
            }
        }
    } else if (showLoggedOutHint) {
        item {
            Text(
                if (statusLoaded) {
                    "登录后即可查看这个平台的个人${platformCollectionLabel(platform)}"
                } else {
                    "正在获取登录状态…"
                },
                Modifier.fillMaxWidth().padding(32.dp),
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
