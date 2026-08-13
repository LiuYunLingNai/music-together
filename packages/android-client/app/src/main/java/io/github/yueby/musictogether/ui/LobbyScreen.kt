package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.model.RoomListItem
import io.github.yueby.musictogether.model.Track

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
    bottomContentPadding: Dp = 0.dp,
    onOpenPlayer: (() -> Unit)? = null,
) {
    var createDialog by remember { mutableStateOf(false) }
    var joinTarget by remember { mutableStateOf<RoomTarget?>(null) }
    var directRoomId by remember { mutableStateOf("") }
    var joinDialogOpen by remember { mutableStateOf(false) }
    var connectionSettingsOpen by remember { mutableStateOf(false) }
    var selectedTab by rememberSaveable { mutableStateOf(LobbyTab.Home) }
    val connectedServerCount = state.servers.count { it.status == ConnectionStatus.Connected }
    val roomCount = state.servers.sumOf { it.rooms.size }

    LaunchedEffect(state.room?.id) {
        if (state.room == null && selectedTab == LobbyTab.Recommendations) {
            selectedTab = LobbyTab.Home
        }
    }

    Column(Modifier.fillMaxSize()) {
        if (selectedTab == LobbyTab.Home) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .padding(contentPadding),
                contentPadding = PaddingValues(
                    start = 20.dp,
                    top = 18.dp,
                    end = 20.dp,
                    bottom = 24.dp + bottomContentPadding,
                ),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "Music Together",
                                style = MaterialTheme.typography.displaySmall,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                text = "$connectedServerCount/${state.servers.size} 台服务器在线",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        HapticIconButton(
                            onClick = viewModel::refreshRooms,
                            enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "刷新房间")
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
                            Text("公开房间", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text(
                                text = "$roomCount 个房间 · ${state.servers.size} 台服务器",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = viewModel::refreshRooms,
                            enabled = state.servers.any { it.status == ConnectionStatus.Connected },
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "刷新房间")
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
        BackHandler { selectedTab = LobbyTab.Home }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(top = contentPadding.calculateTopPadding()),
        ) {
            when (selectedTab) {
                LobbyTab.Search -> if (state.connectionStatus == ConnectionStatus.Connected) {
                    SearchPane(state, viewModel)
                } else {
                    LobbySearchUnavailablePane(onOpenSettings = { connectionSettingsOpen = true })
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
                    onOpenConnectionSettings = { connectionSettingsOpen = true },
                )
                LobbyTab.Home -> Unit
            }
        }
    }

    LobbyBottomNavigation(
        selectedTab = selectedTab,
        onTabSelected = { selectedTab = it },
        showRecommendations = state.room != null,
        modifier = Modifier.padding(bottom = contentPadding.calculateBottomPadding()),
    )

    }

    if (connectionSettingsOpen) {
        ConnectionSettingsDialog(
            state = state,
            viewModel = viewModel,
            onDismiss = { connectionSettingsOpen = false },
        )
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
private fun LobbySectionTitle(title: String, icon: ImageVector) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
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

@Composable
private fun LobbyActionCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(16.dp)
    val onHapticClick = rememberHapticClick(onClick)
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
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
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
    val shape = RoundedCornerShape(16.dp)
    val onHapticClick = if (onClick != null) rememberHapticClick(onClick) else ({})
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
    ) {
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
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.MusicNote, contentDescription = null)
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = track.artist.joinToString(" / "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "打开播放器",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回首页")
        }
        Text(
            title,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        onAction?.let { action ->
            IconButton(onClick = action) {
                Icon(Icons.Default.Settings, contentDescription = "服务器设置")
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
    val shape = RoundedCornerShape(12.dp)
    val onHapticClick = rememberHapticClick(onClick)
    Card(
        onClick = onHapticClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.38f), shape),
        shape = shape,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.74f),
        ),
    ) {
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
}
