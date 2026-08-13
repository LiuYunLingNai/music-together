package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.model.usesFloatingBottomBar
import io.github.yueby.musictogether.ui.designsystem.LocalAppBlurEnabled
import io.github.yueby.musictogether.ui.designsystem.LocalBottomBarStyle
import io.github.yueby.musictogether.ui.designsystem.LocalGlassBottomBarEnabled
import io.github.yueby.musictogether.ui.designsystem.LocalAppPageBackground
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import io.github.yueby.musictogether.ui.designsystem.rememberAppBlurBackdrop
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.layerBackdrop
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

private data class RoomTarget(val serverUrl: String, val room: RoomListItem)

internal enum class LobbyBackAction {
    CloseLocalLibrary,
    ExitApp,
}

internal fun resolveLobbyBackAction(localLibraryOpen: Boolean): LobbyBackAction =
    if (localLibraryOpen) LobbyBackAction.CloseLocalLibrary else LobbyBackAction.ExitApp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    state: AppState,
    contentPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    onOpenPlayer: (() -> Unit)? = null,
    bottomAccessory: (@Composable (LayerBackdrop?, Boolean) -> Unit)? = null,
) {
    var createDialog by remember { mutableStateOf(false) }
    var joinTarget by remember { mutableStateOf<RoomTarget?>(null) }
    var directRoomId by remember { mutableStateOf("") }
    var joinDialogOpen by remember { mutableStateOf(false) }
    var selectedTab by rememberSaveable { mutableStateOf(LobbyTab.Home) }
    var settingsNested by rememberSaveable { mutableStateOf(false) }
    var requestedSettingsDestination by rememberSaveable { mutableStateOf<SettingsDestination?>(null) }
    val connectedServerCount = state.servers.count { it.status == ConnectionStatus.Connected }
    val roomCount = state.servers.sumOf { it.rooms.size }
    val layoutDirection = LocalLayoutDirection.current
    val floatingBar = LocalUiStyle.current.usesFloatingBottomBar(LocalBottomBarStyle.current)
    val navigationBarInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val blurBackdrop = rememberAppBlurBackdrop(
        enabled = LocalUiStyle.current == UiStyle.Miuix &&
            floatingBar &&
            LocalAppBlurEnabled.current &&
            LocalGlassBottomBarEnabled.current,
    )
    val showDock = selectedTab != LobbyTab.Settings || !settingsNested
    val sideBySideDock = showDock && floatingBar && bottomAccessory != null
    val dockHeight = if (showDock) bottomDockContentHeight(
        floating = floatingBar,
        hasAccessory = bottomAccessory != null,
        sideBySideAccessory = sideBySideDock,
        navigationBarInset = navigationBarInset,
        scaffoldBottomInset = contentPadding.calculateBottomPadding(),
    ) else 0.dp

    LaunchedEffect(selectedTab) {
        if (selectedTab != LobbyTab.Settings) settingsNested = false
    }

    LaunchedEffect(state.room?.id) {
        if (state.room == null && selectedTab == LobbyTab.Recommendations) {
            selectedTab = LobbyTab.Home
        }
    }

    BackHandler(enabled = selectedTab != LobbyTab.Home) { selectedTab = LobbyTab.Home }

    Box(Modifier.fillMaxSize().background(LocalAppPageBackground.current)) {
        Column(
            Modifier
                .fillMaxSize()
                .then(if (blurBackdrop != null) Modifier.layerBackdrop(blurBackdrop) else Modifier),
        ) {
        Box(Modifier.weight(1f)) {
        val visibleTab = selectedTab
        if (visibleTab == LobbyTab.Home) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(
                        start = contentPadding.calculateLeftPadding(layoutDirection),
                        top = contentPadding.calculateTopPadding(),
                        end = contentPadding.calculateRightPadding(layoutDirection),
                    ),
                contentPadding = PaddingValues(
                    start = 20.dp,
                    top = 18.dp,
                    end = 20.dp,
                    bottom = 24.dp + dockHeight,
                ),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(Modifier.weight(1f)) {
                            LobbyHeading(
                                title = "Music Together",
                                summary = "$connectedServerCount/${state.servers.size} 台服务器在线",
                            )
                        }
                        LobbyIconButton(
                            onClick = viewModel::refreshRooms,
                            enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                        ) {
                            LobbyIcon(Icons.Default.Refresh, contentDescription = "刷新房间")
                        }
                    }
                }
                state.room?.currentTrack?.let { track ->
                    item {
                        LobbySectionTitle(title = "继续播放", icon = Icons.Default.MusicNote)
                        TrackResumeCard(track = track, onClick = onOpenPlayer)
                    }
                }
                item {
                    LobbySectionTitle(title = "快速开始", icon = Icons.Default.Add)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        LobbyActionCard(
                            icon = Icons.Default.Add,
                            title = "创建房间",
                            subtitle = "邀请朋友一起听",
                            onClick = { createDialog = true },
                            modifier = Modifier.weight(1f),
                        )
                        LobbyActionCard(
                            icon = Icons.AutoMirrored.Filled.ArrowForward,
                            title = "加入房间",
                            subtitle = "输入房间号或链接",
                            onClick = { joinDialogOpen = true },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            LobbyHeading(
                                title = "公开房间",
                                summary = "$roomCount 个房间 · ${state.servers.size} 台服务器",
                                compact = true,
                            )
                        }
                        LobbyIconButton(
                            onClick = viewModel::refreshRooms,
                            enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                        ) {
                            LobbyIcon(Icons.Default.Refresh, contentDescription = "刷新房间")
                        }
                    }
                }
                if (state.servers.all { it.rooms.isEmpty() }) {
                    item {
                        EmptyRoomList(
                            title = if (state.servers.any { it.status == ConnectionStatus.Connected }) {
                                "暂无公开房间"
                            } else {
                                "正在连接服务器"
                            },
                        )
                    }
                } else {
                    state.servers.filter { it.rooms.isNotEmpty() }.forEach { server ->
                        item(key = "server:${server.url}") {
                            ServerHeader(
                                url = server.url,
                                status = server.status,
                                roomCount = server.rooms.size,
                                selected = server.url == state.selectedServerUrl,
                            )
                        }
                        items(server.rooms, key = { room -> "${server.url}:${room.id}" }) { room ->
                            RoomCard(room) {
                                if (room.hasPassword) {
                                    joinTarget = RoomTarget(server.url, room)
                                } else {
                                    viewModel.joinRoomOnServer(server.url, room.id)
                                }
                            }
                        }
                    }
                }
            }
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(bottom = dockHeight)
                .padding(
                    top = if (visibleTab == LobbyTab.Settings && LocalUiStyle.current == UiStyle.Miuix) {
                        0.dp
                    } else {
                        contentPadding.calculateTopPadding()
                    },
                ),
        ) {
            when (visibleTab) {
                LobbyTab.Search -> if (state.connectionStatus == ConnectionStatus.Connected) {
                    SearchPane(state, viewModel)
                } else {
                    LobbySearchUnavailablePane(
                        onOpenSettings = {
                            requestedSettingsDestination = SettingsDestination.Server
                            selectedTab = LobbyTab.Settings
                        },
                    )
                }
                LobbyTab.Library -> LocalMusicPane(
                    state = state,
                    viewModel = viewModel,
                    onBack = { selectedTab = LobbyTab.Home },
                )
                LobbyTab.Recommendations -> LobbyRecommendationsPane(state, viewModel)
                LobbyTab.Settings -> LobbySettingsPane(
                    state = state,
                    viewModel = viewModel,
                    requestedDestination = requestedSettingsDestination,
                    onRequestedDestinationConsumed = { requestedSettingsDestination = null },
                    onNavigationDepthChanged = { settingsNested = it },
                )
                LobbyTab.Home -> Unit
            }
        }
    }

        }

        }

        if (showDock) Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(dockHeight),
        ) {
            if (sideBySideDock) {
                val compactAccessory = requireNotNull(bottomAccessory)
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(
                            start = 12.dp,
                            end = 12.dp,
                            bottom = floatingNavigationBottomPadding(navigationBarInset),
                        )
                        .height(LobbyNavigationDefaults.FloatingHeight),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        compactAccessory(blurBackdrop, true)
                    }
                    LobbyBottomNavigation(
                        selectedTab = selectedTab,
                        onTabSelected = { selectedTab = it },
                        showRecommendations = state.room != null,
                        modifier = Modifier.weight(1f),
                        blurBackdrop = blurBackdrop,
                        compact = true,
                    )
                }
            } else Column(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            ) {
                bottomAccessory?.let { accessory ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(LobbyNavigationDefaults.AccessoryHeight),
                    ) {
                        accessory(blurBackdrop, false)
                    }
                    Spacer(Modifier.height(LobbyNavigationDefaults.AccessorySpacing))
                }
                LobbyBottomNavigation(
                    selectedTab = selectedTab,
                    onTabSelected = { selectedTab = it },
                    showRecommendations = state.room != null,
                    blurBackdrop = blurBackdrop,
                )
            }
        }
    }

    if (joinDialogOpen) {
        JoinRoomDialog(
            initialValue = directRoomId,
            onDismiss = { joinDialogOpen = false },
            onJoin = { input ->
                directRoomId = input
                joinDialogOpen = false
                viewModel.joinRoomInput(input)
            },
        )
    }
    if (createDialog) {
        CreateRoomDialog(
            servers = state.servers,
            initialServerUrl = state.selectedServerUrl,
            onDismiss = { createDialog = false },
            onCreate = { serverUrl, name, password ->
                createDialog = false
                viewModel.createRoomOnServer(serverUrl, name, password)
            },
        )
    }
    joinTarget?.let { target ->
        PasswordDialog(target.room.name, onDismiss = { joinTarget = null }) { password ->
            joinTarget = null
            viewModel.joinRoomOnServer(target.serverUrl, target.room.id, password)
        }
    }
}

@Composable
private fun LobbyHeading(
    title: String,
    summary: String,
    compact: Boolean = false,
) {
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixText(
            text = title,
            style = if (compact) MiuixTheme.textStyles.title2 else MiuixTheme.textStyles.title1,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        MiuixText(
            text = summary,
            style = if (compact) MiuixTheme.textStyles.footnote1 else MiuixTheme.textStyles.body2,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    } else {
        Text(
            text = title,
            style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = summary,
            style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LobbyIconButton(
    onClick: () -> Unit,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val onHapticClick = rememberHapticClick(onClick)
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixIconButton(onClick = onHapticClick, enabled = enabled, content = content)
    } else {
        IconButton(onClick = onHapticClick, enabled = enabled, content = content)
    }
}

@Composable
private fun LobbyIcon(
    imageVector: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
) {
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixIcon(
            imageVector = imageVector,
            contentDescription = contentDescription,
            modifier = modifier,
            tint = MiuixTheme.colorScheme.onSurface,
        )
    } else {
        Icon(
            imageVector = imageVector,
            contentDescription = contentDescription,
            modifier = modifier,
        )
    }
}

@Composable
private fun LobbySectionTitle(title: String, icon: ImageVector) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (LocalUiStyle.current == UiStyle.Miuix) {
            MiuixIcon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(26.dp),
                tint = MiuixTheme.colorScheme.onSurfaceVariantActions,
            )
            MiuixText(
                text = title,
                style = MiuixTheme.textStyles.title2,
                fontWeight = FontWeight.Bold,
            )
        } else {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(26.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun LobbyActionCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val onHapticClick = rememberHapticClick(onClick)
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixCard(
            modifier = modifier.height(112.dp),
            onClick = onHapticClick,
        ) {
            LobbyActionCardContent(icon, title, subtitle, miuix = true)
        }
    } else {
        val shape = RoundedCornerShape(16.dp)
        Card(
            onClick = onHapticClick,
            modifier = modifier
                .height(112.dp)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f), shape),
            shape = shape,
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.78f),
            ),
        ) {
            LobbyActionCardContent(icon, title, subtitle, miuix = false)
        }
    }
}

@Composable
private fun LobbyActionCardContent(
    icon: ImageVector,
    title: String,
    subtitle: String,
    miuix: Boolean,
) {
    Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (miuix) {
            MiuixIcon(icon, null, Modifier.size(24.dp), tint = MiuixTheme.colorScheme.primary)
            MiuixText(
                title,
                style = MiuixTheme.textStyles.title4,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            MiuixText(
                subtitle,
                style = MiuixTheme.textStyles.footnote2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            Icon(icon, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun TrackResumeCard(track: Track, onClick: (() -> Unit)?) {
    val onHapticClick = if (onClick != null) rememberHapticClick(onClick) else ({})
    val content: @Composable () -> Unit = {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (track.cover.isNotBlank()) {
                AsyncImage(
                    model = track.cover,
                    contentDescription = track.title,
                    modifier = Modifier
                        .size(68.dp)
                        .clip(RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(68.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            if (LocalUiStyle.current == UiStyle.Miuix) {
                                MiuixTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.primaryContainer
                            },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    LobbyIcon(Icons.Default.MusicNote, contentDescription = null)
                }
            }
            Column(Modifier.weight(1f)) {
                if (LocalUiStyle.current == UiStyle.Miuix) {
                    MiuixText(
                        track.title,
                        style = MiuixTheme.textStyles.title3,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    MiuixText(
                        track.artist.joinToString(" / "),
                        style = MiuixTheme.textStyles.body2,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    Text(
                        track.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        track.artist.joinToString(" / "),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (LocalUiStyle.current == UiStyle.Miuix) {
                MiuixIcon(
                    Icons.AutoMirrored.Filled.ArrowForward,
                    "打开播放器",
                    tint = MiuixTheme.colorScheme.onSurfaceVariantActions,
                )
            } else {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowForward,
                    "打开播放器",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixCard(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            onClick = if (onClick != null) onHapticClick else null,
        ) { content() }
    } else {
        val shape = RoundedCornerShape(16.dp)
        Card(
            onClick = onHapticClick,
            enabled = onClick != null,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f), shape),
            shape = shape,
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.78f),
            ),
        ) { content() }
    }
}

@Composable
internal fun LobbyTabHeader(
    title: String,
    onBack: () -> Unit,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LobbyIconButton(onClick = onBack) {
            LobbyIcon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回首页")
        }
        if (LocalUiStyle.current == UiStyle.Miuix) {
            MiuixText(
                title,
                modifier = Modifier.weight(1f),
                style = MiuixTheme.textStyles.title2,
                fontWeight = FontWeight.Bold,
            )
        } else {
            Text(
                title,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
        onAction?.let { action ->
            LobbyIconButton(onClick = action) {
                LobbyIcon(Icons.Default.Settings, contentDescription = "服务器设置")
            }
        }
    }
}

@Composable
private fun LobbySearchUnavailablePane(onOpenSettings: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = null,
            modifier = Modifier.size(36.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = "连接服务器后搜索歌曲",
            modifier = Modifier.padding(top = 12.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "搜索结果会根据当前服务器和已选音源返回",
            modifier = Modifier.padding(top = 6.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        TextButton(onClick = onOpenSettings, modifier = Modifier.padding(top = 8.dp)) {
            Icon(Icons.Default.Dns, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("连接服务器", modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun LobbySearchPane(
    state: AppState,
    directRoomId: String,
    onDirectRoomIdChange: (String) -> Unit,
    onJoinDirectRoom: () -> Unit,
    onJoinRoom: (String, RoomListItem) -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        LobbyTabHeader(title = "搜索房间", onBack = onBack)
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("加入房间", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = directRoomId,
                        onValueChange = onDirectRoomIdChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("房间号或邀请链接") },
                        trailingIcon = {
                            IconButton(onClick = onJoinDirectRoom, enabled = directRoomId.isNotBlank()) {
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = "加入房间")
                            }
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (directRoomId.isNotBlank()) onJoinDirectRoom() }),
                    )
                }
            }
            item {
                Text("公开房间", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            if (state.servers.all { it.rooms.isEmpty() }) {
                item { EmptyRoomList("暂无可加入的公开房间") }
            } else {
                state.servers.filter { it.rooms.isNotEmpty() }.forEach { server ->
                    item(key = "search-server:${server.url}") {
                        ServerHeader(
                            url = server.url,
                            status = server.status,
                            roomCount = server.rooms.size,
                            selected = server.url == state.selectedServerUrl,
                        )
                    }
                    items(server.rooms, key = { room -> "search:${server.url}:${room.id}" }) { room ->
                        RoomCard(room) { onJoinRoom(server.url, room) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyRoomList(title: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Default.People,
            contentDescription = null,
            modifier = Modifier.size(30.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ServerHeader(
    url: String,
    status: ConnectionStatus,
    roomCount: Int,
    selected: Boolean,
) {
    val statusColor =
        when (status) {
            ConnectionStatus.Connected -> MaterialTheme.colorScheme.primary
            ConnectionStatus.Connecting -> MaterialTheme.colorScheme.tertiary
            ConnectionStatus.Disconnected -> MaterialTheme.colorScheme.outline
        }
    val subtitle =
        when (status) {
            ConnectionStatus.Connected -> if (selected) "当前服务器" else "$roomCount 个房间"
            ConnectionStatus.Connecting -> "正在连接"
            ConnectionStatus.Disconnected -> "已离线"
        }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(statusColor),
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = url.removePrefix("https://").removePrefix("http://"),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RoomCard(room: RoomListItem, onClick: () -> Unit) {
    val onHapticClick = rememberHapticClick(onClick)
    val content: @Composable () -> Unit = {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = room.name,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (room.hasPassword) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = "需要密码",
                        modifier = Modifier.size(17.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.People,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = room.userCount.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "房间号 ${room.id}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                room.currentTrackTitle?.let { title ->
                    Icon(
                        imageVector = Icons.Default.MusicNote,
                        contentDescription = null,
                        modifier = Modifier
                            .padding(start = 6.dp)
                            .size(16.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = "$title${room.currentTrackArtist?.let { " · $it" }.orEmpty()}",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixCard(
            modifier = Modifier.fillMaxWidth(),
            insideMargin = PaddingValues(0.dp),
            onClick = onHapticClick,
        ) { content() }
    } else {
        val shape = RoundedCornerShape(12.dp)
        Card(
            onClick = onHapticClick,
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.38f), shape),
            shape = shape,
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.74f),
            ),
        ) { content() }
    }
}
