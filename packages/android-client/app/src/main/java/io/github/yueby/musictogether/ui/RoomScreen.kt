package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ChatMessage
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.RoomState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.player.PlayerUiState
import java.text.BreakIterator
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.coroutines.delay

private enum class RoomTab(val label: String) {
    Player("播放"), Queue("队列"), Search("点歌"), Account("账号"), Chat("聊天")
}

private enum class RoomOverlay {
    Queue, Search, Chat, Members, Accounts, AccountSettings, RoomSettings
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    appState: AppState,
    playerState: PlayerUiState,
    outerPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
) {
    val room = appState.room ?: return
    var selectedTab by remember { mutableStateOf(RoomTab.Player) }
    var activeOverlay by remember { mutableStateOf<RoomOverlay?>(null) }
    val overlaySheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val navigateBack = {
        when {
            activeOverlay != null -> activeOverlay = null
            selectedTab != RoomTab.Player -> selectedTab = RoomTab.Player
            else -> viewModel.leaveRoom()
        }
    }

    BackHandler(onBack = navigateBack)
    LaunchedEffect(activeOverlay) {
        viewModel.setChatVisible(activeOverlay == RoomOverlay.Chat)
    }
    DisposableEffect(Unit) {
        onDispose { viewModel.setChatVisible(false) }
    }

    Scaffold(
        modifier = Modifier.padding(outerPadding),
        topBar = {
            var menuExpanded by remember { mutableStateOf(false) }
            val dividerColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.50f)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.95f))
                    .drawWithContent {
                        drawContent()
                        drawLine(
                            color = dividerColor,
                            start = androidx.compose.ui.geometry.Offset(0f, size.height - 1f),
                            end = androidx.compose.ui.geometry.Offset(size.width, size.height - 1f),
                            strokeWidth = 1f,
                        )
                    }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = room.name,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { activeOverlay = RoomOverlay.Members }
                        .padding(horizontal = 6.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(
                        Icons.Default.Groups,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        room.users.size.toString(),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (room.hasPassword) {
                        Icon(
                            Icons.Default.Lock,
                            contentDescription = "密码房间",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Spacer(Modifier.size(6.dp))
                IconButton(onClick = { activeOverlay = RoomOverlay.Search }) {
                    Icon(Icons.Default.Search, "搜索点歌", Modifier.size(20.dp))
                }
                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Default.MoreVert, "更多操作", Modifier.size(20.dp))
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("个人账号") },
                            onClick = {
                                menuExpanded = false
                                activeOverlay = RoomOverlay.AccountSettings
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("房间与音质") },
                            onClick = {
                                menuExpanded = false
                                activeOverlay = RoomOverlay.RoomSettings
                            },
                        )
                        DropdownMenuItem(
                            leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                            text = { Text("复制房间链接") },
                            onClick = {
                                menuExpanded = false
                                viewModel.copyRoomLink()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("音源账号与歌单") },
                            onClick = {
                                menuExpanded = false
                                activeOverlay = RoomOverlay.Accounts
                            },
                        )
                        if (BuildConfig.DEBUG) {
                            DropdownMenuItem(
                                text = { Text("导出日志") },
                                onClick = {
                                    menuExpanded = false
                                    AppLogger.export(context)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("清空日志") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.clearLogs()
                                },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("离开房间") },
                            onClick = {
                                menuExpanded = false
                                viewModel.leaveRoom()
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (selectedTab) {
                RoomTab.Player, RoomTab.Account -> PlayerPane(
                    room = room,
                    userId = appState.userId,
                    lyrics = appState.lyrics,
                    player = playerState,
                    viewModel = viewModel,
                    onOpenQueue = { activeOverlay = RoomOverlay.Queue },
                    onOpenChat = { activeOverlay = RoomOverlay.Chat },
                )
                else -> Unit
            }
            appState.activeVote?.let { vote ->
                val hasVoted = appState.userId?.let(vote.votes::containsKey) == true
                val approveCount = vote.votes.values.count { it }
                val rejectCount = vote.votes.values.count { !it }
                Card(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${vote.initiatorNickname} 发起了“${voteActionLabel(vote.action)}”投票", fontWeight = FontWeight.SemiBold)
                        vote.payload["trackTitle"]?.takeIf { it.isNotBlank() }?.let {
                            Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text("赞成 $approveCount · 反对 $rejectCount · 需要 ${vote.requiredVotes} 票", style = MaterialTheme.typography.bodySmall)
                        if (hasVoted) {
                            Text(
                                if (vote.initiatorId == appState.userId) "你发起了投票，已自动计入赞成票" else "你已投票",
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold,
                            )
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { viewModel.castVote(true) }) { Text("同意") }
                                OutlinedButton(onClick = { viewModel.castVote(false) }) { Text("反对") }
                            }
                        }
                    }
                }
            }
        }
    }

    activeOverlay?.let { overlay ->
        ModalBottomSheet(
            onDismissRequest = { activeOverlay = null },
            sheetState = overlaySheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(
                        when (overlay) {
                            RoomOverlay.Queue, RoomOverlay.Chat, RoomOverlay.Members -> 0.70f
                            RoomOverlay.Accounts, RoomOverlay.AccountSettings, RoomOverlay.RoomSettings -> 0.90f
                            RoomOverlay.Search -> 0.96f
                        },
                    ),
            ) {
                when (overlay) {
                    RoomOverlay.Queue -> QueuePane(room, viewModel)
                    RoomOverlay.Search -> SearchPane(appState, viewModel)
                    RoomOverlay.Chat -> ChatPane(appState.messages, viewModel)
                    RoomOverlay.Members -> MembersPane(room, appState.userId)
                    RoomOverlay.Accounts -> PlatformPane(appState, viewModel)
                    RoomOverlay.AccountSettings -> AccountSettingsPane(appState, viewModel)
                    RoomOverlay.RoomSettings -> RoomSettingsPane(appState, viewModel)
                }
            }
        }
    }
}

@Composable
private fun PlayerPane(
    room: RoomState,
    userId: String?,
    lyrics: LyricsState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val track = player.track ?: room.currentTrack
    // Player visual is a room-level preference. Changing tracks must not force
    // users out of the lyrics view.
    var lyricsExpanded by remember(room.id) { mutableStateOf(false) }

    MobilePlayerSurface(
        track = track,
        room = room,
        lyrics = lyrics,
        player = player,
        viewModel = viewModel,
        lyricsExpanded = lyricsExpanded,
        onToggleLyrics = { lyricsExpanded = !lyricsExpanded },
        onOpenQueue = onOpenQueue,
        onOpenChat = onOpenChat,
    )
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobilePlayerSurface(
    track: Track?,
    room: RoomState,
    lyrics: LyricsState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    lyricsExpanded: Boolean,
    onToggleLyrics: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val playerShape = RoundedCornerShape(16.dp)
    val backgroundScale by animateFloatAsState(
        targetValue = if (player.playing) 1.30f else 1.22f,
        animationSpec = tween(3200),
        label = "background-scale",
    )
    val backgroundFlow = rememberInfiniteTransition(label = "background-flow")
    val backgroundDriftX by backgroundFlow.animateFloat(
        initialValue = -18f,
        targetValue = 18f,
        animationSpec = infiniteRepeatable(
            animation = tween(11_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "background-drift-x",
    )
    val backgroundDriftY by backgroundFlow.animateFloat(
        initialValue = 12f,
        targetValue = -12f,
        animationSpec = infiniteRepeatable(
            animation = tween(13_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "background-drift-y",
    )

    Box(
        Modifier
            .fillMaxSize()
            .padding(8.dp)
            .clip(playerShape)
            .background(Color(0xFF111111)),
    ) {
        if (!track?.cover.isNullOrBlank()) {
            AsyncImage(
                model = track?.cover,
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = backgroundScale
                        scaleY = backgroundScale
                        translationX = if (player.playing) backgroundDriftX else 0f
                        translationY = if (player.playing) backgroundDriftY else 0f
                        rotationZ = if (player.playing) backgroundDriftX * 0.025f else 0f
                        alpha = 0.68f
                    }
                    .blur(54.dp),
                contentScale = ContentScale.Crop,
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.14f),
                            Color.Black.copy(alpha = 0.46f),
                        ),
                        radius = 1250f,
                    ),
                )
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.24f),
                        0.50f to Color.Black.copy(alpha = 0.08f),
                        1f to Color.Black.copy(alpha = 0.48f),
                    ),
                ),
        )

        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .widthIn(max = 448.dp)
                .fillMaxHeight()
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 18.dp),
        ) {
            SharedTransitionLayout(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                AnimatedContent(
                    targetState = lyricsExpanded && track != null,
                    transitionSpec = {
                        fadeIn(tween(360, delayMillis = 80)) togetherWith fadeOut(tween(180))
                    },
                    modifier = Modifier.fillMaxSize(),
                    label = "player-visual",
                ) { showLyrics ->
                    if (showLyrics && track != null) {
                        MobileLyricsHero(
                            track = track,
                            lyrics = lyrics,
                            player = player,
                            onShowCover = onToggleLyrics,
                            onOpenChat = onOpenChat,
                            onSeek = viewModel::seek,
                            sharedTransitionScope = this@SharedTransitionLayout,
                            animatedVisibilityScope = this,
                        )
                    } else {
                        MobileCoverHero(
                            track = track,
                            onShowLyrics = onToggleLyrics,
                            sharedTransitionScope = this@SharedTransitionLayout,
                            animatedVisibilityScope = this,
                        )
                    }
                }
            }

            if (!lyricsExpanded) {
                Spacer(Modifier.height(14.dp))
                MobileSongInfo(
                    track = track,
                    error = player.error,
                    onOpenChat = onOpenChat,
                )
            }
            Spacer(Modifier.height(if (lyricsExpanded) 10.dp else 16.dp))
            MobilePlayerControls(
                track = track,
                room = room,
                player = player,
                viewModel = viewModel,
                onOpenQueue = onOpenQueue,
            )
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobileCoverHero(
    track: Track?,
    onShowLyrics: () -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val coverInteraction = remember { MutableInteractionSource() }
    val coverPressed by coverInteraction.collectIsPressedAsState()
    val coverScale by animateFloatAsState(
        targetValue = if (coverPressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 420f),
        label = "cover-press-scale",
    )
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        val artworkSize = minOf(maxWidth, maxHeight).coerceAtMost(430.dp)
        val cornerRadius by animateDpAsState(
            targetValue = 24.dp,
            animationSpec = spring(dampingRatio = 0.86f, stiffness = 260f),
            label = "cover-corner",
        )
        if (track != null && track.cover.isNotBlank()) {
            AsyncImage(
                model = track.cover,
                contentDescription = "打开歌词",
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .size(artworkSize)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-cover-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                            boundsTransform = { _, _ ->
                                spring(dampingRatio = 0.82f, stiffness = 180f)
                            },
                        )
                }
                    .graphicsLayer {
                        shadowElevation = 18.dp.toPx()
                        shape = RoundedCornerShape(cornerRadius)
                        clip = true
                        scaleX = coverScale
                        scaleY = coverScale
                    }
                    .clickable(
                        interactionSource = coverInteraction,
                        indication = null,
                        onClick = onShowLyrics,
                    ),
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                Modifier
                    .size(artworkSize)
                    .clip(RoundedCornerShape(cornerRadius))
                    .background(Color.White.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.LibraryMusic,
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = Color.White.copy(alpha = 0.72f),
                )
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MobileLyricsHero(
    track: Track,
    lyrics: LyricsState,
    player: PlayerUiState,
    onShowCover: () -> Unit,
    onOpenChat: () -> Unit,
    onSeek: (Double) -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val coverInteraction = remember { MutableInteractionSource() }
    val coverPressed by coverInteraction.collectIsPressedAsState()
    val coverScale by animateFloatAsState(
        targetValue = if (coverPressed) 0.92f else 1f,
        animationSpec = spring(dampingRatio = 0.78f, stiffness = 480f),
        label = "compact-cover-press-scale",
    )
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            AsyncImage(
                model = track.cover,
                contentDescription = "返回封面",
                modifier = with(sharedTransitionScope) {
                    Modifier
                        .size(56.dp)
                        .sharedElement(
                            sharedContentState = rememberSharedContentState("player-cover-${track.id}"),
                            animatedVisibilityScope = animatedVisibilityScope,
                            boundsTransform = { _, _ ->
                                spring(dampingRatio = 0.82f, stiffness = 180f)
                            },
                        )
                }
                    .graphicsLayer {
                        shadowElevation = 8.dp.toPx()
                        shape = RoundedCornerShape(9.dp)
                        clip = true
                        scaleX = coverScale
                        scaleY = coverScale
                    }
                    .clickable(
                        interactionSource = coverInteraction,
                        indication = null,
                        onClick = onShowCover,
                    ),
                contentScale = ContentScale.Crop,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.94f),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
                Text(
                    text = track.artist.joinToString(" / "),
                    modifier = Modifier.basicMarquee(),
                    color = Color.White.copy(alpha = 0.56f),
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                )
            }
            IconButton(
                onClick = onOpenChat,
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Chat,
                    contentDescription = "打开聊天",
                    tint = Color.White.copy(alpha = 0.72f),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            LyricsPanel(
                lyrics = lyrics,
                positionSeconds = player.positionSeconds,
                isPlaying = player.playing,
                onSeek = onSeek,
            )
        }
    }
}

@Composable
private fun MobileSongInfo(
    track: Track?,
    error: String?,
    onOpenChat: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = track?.title ?: "暂无歌曲",
                modifier = Modifier.basicMarquee(),
                color = Color.White.copy(alpha = 0.94f),
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
            Text(
                text = error ?: track?.artist?.joinToString(" / ") ?: "点击搜索添加歌曲到队列",
                modifier = Modifier.basicMarquee(),
                color = if (error == null) Color.White.copy(alpha = 0.52f) else Color(0xFFFF8A80),
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
        }
        IconButton(
            onClick = onOpenChat,
            modifier = Modifier.size(40.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = "打开聊天",
                tint = Color.White.copy(alpha = 0.72f),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MobilePlayerControls(
    track: Track?,
    room: RoomState,
    player: PlayerUiState,
    viewModel: MusicTogetherViewModel,
    onOpenQueue: () -> Unit,
) {
    var seeking by remember(track?.id) { mutableStateOf(false) }
    var seekPosition by remember(track?.id) { mutableDoubleStateOf(player.positionSeconds) }
    LaunchedEffect(player.positionSeconds) {
        if (!seeking) seekPosition = player.positionSeconds
    }
    val duration = (track?.duration ?: 0.0).coerceAtLeast(1.0)
    val seekThumbSize by animateDpAsState(
        targetValue = if (seeking) 10.dp else 7.dp,
        animationSpec = spring(dampingRatio = 0.72f, stiffness = 520f),
        label = "seek-thumb-size",
    )

    Column(Modifier.fillMaxWidth()) {
        Slider(
            value = seekPosition.coerceIn(0.0, duration).toFloat(),
            onValueChange = {
                seeking = true
                seekPosition = it.toDouble()
            },
            onValueChangeFinished = {
                seeking = false
                viewModel.seek(seekPosition)
            },
            valueRange = 0f..duration.toFloat(),
            enabled = track != null && viewModel.canControl(),
            modifier = Modifier
                .fillMaxWidth()
                .height(32.dp),
            thumb = {
                Box(
                    Modifier
                        .size(seekThumbSize)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = if (seeking) 0.96f else 0.78f)),
                )
            },
            track = { sliderState ->
                SliderDefaults.Track(
                    sliderState = sliderState,
                    modifier = Modifier.height(3.dp),
                    colors = SliderDefaults.colors(
                        activeTrackColor = Color.White.copy(alpha = 0.72f),
                        inactiveTrackColor = Color.White.copy(alpha = 0.20f),
                    ),
                    thumbTrackGapSize = 0.dp,
                    trackInsideCornerSize = 1.5.dp,
                    drawStopIndicator = null,
                )
            },
        )
        Row(Modifier.fillMaxWidth()) {
            Text(
                formatTime(if (track == null) 0.0 else seekPosition),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = 11.sp,
            )
            Spacer(Modifier.weight(1f))
            Text(
                formatTime(track?.duration ?: 0.0),
                color = Color.White.copy(alpha = 0.52f),
                fontSize = 11.sp,
            )
        }
        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                IconButton(
                    onClick = {
                        val modes = listOf("sequential", "loop-all", "loop-one", "shuffle")
                        val current = modes.indexOf(room.playMode).coerceAtLeast(0)
                        viewModel.setPlayMode(modes[(current + 1) % modes.size])
                    },
                    enabled = track != null,
                ) {
                    Icon(
                        imageVector = when (room.playMode) {
                            "loop-one" -> Icons.Default.RepeatOne
                            "shuffle" -> Icons.Default.Shuffle
                            else -> Icons.Default.Repeat
                        },
                        contentDescription = "切换播放模式",
                        modifier = Modifier.size(21.dp),
                        tint = Color.White.copy(alpha = 0.72f),
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconButton(
                    onClick = viewModel::previous,
                    enabled = track != null,
                    modifier = Modifier.size(42.dp),
                ) {
                    Icon(
                        Icons.Default.FastRewind,
                        contentDescription = "上一首",
                        modifier = Modifier.size(24.dp),
                        tint = Color.White.copy(alpha = 0.84f),
                    )
                }
                IconButton(
                    onClick = viewModel::togglePlayback,
                    enabled = track != null,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.20f)),
                ) {
                    Icon(
                        if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (player.playing) "暂停" else "播放",
                        modifier = Modifier.size(30.dp),
                        tint = Color.White.copy(alpha = 0.94f),
                    )
                }
                IconButton(
                    onClick = viewModel::next,
                    enabled = track != null,
                    modifier = Modifier.size(42.dp),
                ) {
                    Icon(
                        Icons.Default.FastForward,
                        contentDescription = "下一首",
                        modifier = Modifier.size(24.dp),
                        tint = Color.White.copy(alpha = 0.84f),
                    )
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                IconButton(onClick = onOpenQueue) {
                    Box(Modifier.size(30.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.QueueMusic,
                            contentDescription = "打开播放队列",
                            modifier = Modifier.align(Alignment.Center),
                            tint = Color.White.copy(alpha = 0.72f),
                        )
                        if (room.queue.isNotEmpty()) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .size(15.dp)
                                    .clip(CircleShape)
                                    .background(Color.White.copy(alpha = 0.90f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = if (room.queue.size > 99) "99+" else room.queue.size.toString(),
                                    color = Color.Black,
                                    fontSize = 7.sp,
                                    lineHeight = 7.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MembersPane(room: RoomState, userId: String?) {
    val roleOrder = mapOf("owner" to 0, "admin" to 1, "member" to 2)
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Groups, contentDescription = null, Modifier.size(20.dp))
            Text(
                "在线成员 (${room.users.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(
                room.users.sortedBy { roleOrder[it.role] ?: 9 },
                key = { it.id },
            ) { user ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.AccountCircle,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                        tint = if (user.id == room.creatorId) {
                            Color(0xFFFFC857)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        user.nickname,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 14.sp,
                    )
                    if (user.id == userId) {
                        Text(
                            "你",
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.secondaryContainer)
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            fontSize = 11.sp,
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        roleLabel(user.role),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun QueuePane(room: RoomState, viewModel: MusicTogetherViewModel) {
    val listState = rememberLazyListState()
    var confirmClear by remember { mutableStateOf(false) }
    val currentIndex = room.queue.indexOfFirst { it.id == room.currentTrack?.id }
    LaunchedEffect(room.currentTrack?.id, room.queue.size) {
        if (currentIndex >= 0) listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0) + 1)
    }
    LaunchedEffect(confirmClear) {
        if (confirmClear) {
            delay(3000)
            confirmClear = false
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        state = listState,
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
    ) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "播放列表 (${room.queue.size})",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (viewModel.canControl() && room.queue.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            if (confirmClear) {
                                confirmClear = false
                                viewModel.clearQueue()
                            } else {
                                confirmClear = true
                            }
                        },
                    ) {
                        Text(
                            if (confirmClear) "确认清空" else "清空",
                            color = if (confirmClear) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
        if (room.queue.isEmpty()) {
            item { Text("队列为空，去点歌页添加歌曲。", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        itemsIndexed(room.queue, key = { index, track -> "${track.id}:$index" }) { index, track ->
            val isCurrent = track.id == room.currentTrack?.id
            val canReorder = viewModel.canControl()
            TrackRow(
                track = track,
                subtitle = buildString {
                    append(track.artist.joinToString(" / "))
                    track.requestedBy?.let { append(" · $it 点歌") }
                    if (isCurrent) append(" · 当前播放")
                },
                primaryAction = if (canReorder) null else ({ viewModel.playTrack(track) }),
                secondaryAction = if (canReorder) null else ({ viewModel.removeTrack(track) }),
                primaryIcon = Icons.Default.PlayArrow,
                secondaryIcon = Icons.Default.Delete,
                onClick = { viewModel.playTrack(track) },
                highlighted = isCurrent,
                compact = true,
                trailingContent = if (canReorder) {
                    {
                        QueueControlMenu(
                            track = track,
                            canMoveUp = index > 0,
                            canMoveDown = index < room.queue.lastIndex,
                            canPin = !isCurrent,
                            onPlay = { viewModel.playTrack(track) },
                            onMoveUp = { viewModel.moveTrack(track, -1) },
                            onMoveDown = { viewModel.moveTrack(track, 1) },
                            onPin = { viewModel.pinTrack(track) },
                            onRemove = { viewModel.removeTrack(track) },
                        )
                    }
                } else null,
            )
            HorizontalDivider()
        }
    }
}

@Composable
private fun SearchPane(state: AppState, viewModel: MusicTogetherViewModel) {
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
            listOf("netease" to "网易云", "tencent" to "QQ 音乐", "kugou" to "酷狗").forEach { (value, label) ->
                AssistChip(onClick = { source = value }, label = { Text(label) }, leadingIcon = if (source == value) {
                    { Icon(Icons.Default.MusicNote, null, Modifier.size(16.dp)) }
                } else null)
            }
        }
        OutlinedTextField(
            value = keyword,
            onValueChange = { keyword = it.take(100) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("歌曲、歌手或专辑") },
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
            Text("未找到结果，请尝试其他关键词或音乐源。", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(
                Modifier.weight(1f),
                state = listState,
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                items(state.searchResults, key = { it.id }) { track ->
                    val isAdded = state.room?.queue?.any { it.id == track.id } == true
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

@Composable
private fun ChatPane(messages: List<ChatMessage>, viewModel: MusicTogetherViewModel) {
    var content by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "聊天",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        LazyColumn(
            modifier = Modifier.weight(1f),
            state = listState,
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(messages, key = { it.id }) { message ->
                if (message.type == "system") {
                    Text(
                        message.content,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.55f))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                    ) {
                        Text("${message.nickname} · ${formatMessageTime(message.timestamp)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(message.content)
                    }
                }
            }
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = content,
                onValueChange = { content = it.take(500) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("说点什么…") },
                maxLines = 3,
                trailingIcon = {
                    IconButton(onClick = { viewModel.sendChat(content); content = "" }, enabled = content.isNotBlank()) {
                        Icon(Icons.AutoMirrored.Filled.Send, "发送")
                    }
                },
            )
        }
    }
}

@Composable
private fun TrackRow(
    track: Track,
    subtitle: String,
    primaryAction: (() -> Unit)?,
    primaryIcon: androidx.compose.ui.graphics.vector.ImageVector,
    secondaryAction: (() -> Unit)? = null,
    secondaryIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onClick: (() -> Unit)? = null,
    highlighted: Boolean = false,
    compact: Boolean = false,
    trailingContent: (@Composable () -> Unit)? = null,
) {
    ListItem(
        modifier = if (onClick != null) Modifier.fillMaxWidth().clickable(onClick = onClick) else Modifier.fillMaxWidth(),
        colors = ListItemDefaults.colors(
            containerColor = if (highlighted) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
        ),
        leadingContent = {
            AsyncImage(
                model = track.cover,
                contentDescription = null,
                modifier = Modifier
                    .size(if (compact) 40.dp else 48.dp)
                    .clip(RoundedCornerShape(if (compact) 6.dp else 8.dp)),
                contentScale = ContentScale.Crop,
            )
        },
        headlineContent = {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 14.sp else 16.sp,
            )
        },
        supportingContent = {
            Text(
                subtitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = if (compact) 12.sp else 14.sp,
            )
        },
        trailingContent = {
            if (trailingContent != null) {
                trailingContent()
            } else {
                Row {
                    primaryAction?.let { IconButton(onClick = it) { Icon(primaryIcon, "播放或投票播放") } }
                    if (secondaryAction != null && secondaryIcon != null) {
                        IconButton(onClick = secondaryAction) { Icon(secondaryIcon, "移除或投票移除") }
                    }
                }
            }
        },
    )
}

@Composable
private fun QueueControlMenu(
    track: Track,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    canPin: Boolean,
    onPlay: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onPin: () -> Unit,
    onRemove: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(Icons.Default.MoreVert, "队列操作") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("播放") },
                leadingIcon = { Icon(Icons.Default.PlayArrow, null) },
                onClick = { expanded = false; onPlay() },
            )
            DropdownMenuItem(
                text = { Text("上移") },
                leadingIcon = { Icon(Icons.Default.KeyboardArrowUp, null) },
                enabled = canMoveUp,
                onClick = { expanded = false; onMoveUp() },
            )
            DropdownMenuItem(
                text = { Text("下移") },
                leadingIcon = { Icon(Icons.Default.KeyboardArrowDown, null) },
                enabled = canMoveDown,
                onClick = { expanded = false; onMoveDown() },
            )
            DropdownMenuItem(
                text = { Text("置顶到当前播放下方") },
                leadingIcon = { Icon(Icons.Default.VerticalAlignTop, null) },
                enabled = canPin,
                onClick = { expanded = false; onPin() },
            )
            DropdownMenuItem(
                text = { Text("移除") },
                leadingIcon = { Icon(Icons.Default.Delete, null) },
                onClick = { expanded = false; onRemove() },
            )
        }
    }
}

private data class AmllLyricGroup(
    val main: LyricLine,
    val backgrounds: List<LyricLine>,
)

private sealed interface AmllLyricListItem {
    data class Line(
        val sourceIndex: Int,
        val group: AmllLyricGroup,
    ) : AmllLyricListItem

    data class Interlude(
        val line: LyricLine,
        val alignEnd: Boolean,
    ) : AmllLyricListItem
}

private fun buildAmllLyricGroups(lines: List<LyricLine>): List<AmllLyricGroup> {
    val foreground = lines.filterNot { it.isBackground || it.isInterlude }
    if (foreground.isEmpty()) return lines.map { AmllLyricGroup(it, emptyList()) }

    val groupedBackgrounds = mutableMapOf<Int, MutableList<LyricLine>>()
    lines.filter { it.isBackground }.forEach { background ->
        val targetIndex = foreground.indices
            .filterNot { foreground[it].isInterlude }
            .maxByOrNull { index ->
                val main = foreground[index]
                minOf(main.endTimeMs, background.endTimeMs) -
                    maxOf(main.startTimeMs, background.startTimeMs)
            }
            ?.takeIf { index ->
                val main = foreground[index]
                minOf(main.endTimeMs, background.endTimeMs) >
                    maxOf(main.startTimeMs, background.startTimeMs)
            }
            ?: foreground.indices
                .filterNot { foreground[it].isInterlude }
                .minByOrNull { abs(foreground[it].startTimeMs - background.startTimeMs) }
                ?.takeIf { abs(foreground[it].startTimeMs - background.startTimeMs) <= 1_200L }

        if (targetIndex != null) {
            groupedBackgrounds.getOrPut(targetIndex) { mutableListOf() } += background
        }
    }

    return foreground.mapIndexed { index, main ->
        AmllLyricGroup(
            main = main,
            backgrounds = groupedBackgrounds[index].orEmpty().sortedBy { it.startTimeMs },
        )
    }
}

@Composable
private fun LyricsPanel(
    lyrics: LyricsState,
    positionSeconds: Double,
    isPlaying: Boolean,
    onSeek: ((Double) -> Unit)? = null,
) {
    val rawPositionMs = (positionSeconds * 1000.0).toFloat().coerceAtLeast(0f)
    val positionMs = rememberSmoothPositionMs(rawPositionMs, isPlaying)
    val positionLong = positionMs.toLong()
    val groups = remember(lyrics.lines) { buildAmllLyricGroups(lyrics.lines) }
    val interludes = remember(lyrics.lines) { lyrics.lines.filter { it.isInterlude } }
    val activeInterlude = interludes.firstOrNull {
        positionLong >= it.startTimeMs && positionLong < it.endTimeMs
    }
    val activeIndex = groups.indexOfLast {
        positionLong >= it.main.startTimeMs && positionLong < it.main.endTimeMs
    }.takeIf { it >= 0 } ?: groups.indexOfLast {
        positionLong >= it.main.startTimeMs
    }

    // AMLL starts moving toward the next line shortly before it begins.
    val focusTime = positionLong + if (isPlaying) 480L else 0L
    val naturalFocusIndex = groups.indexOfLast {
        focusTime >= it.main.startTimeMs && focusTime < it.main.endTimeMs
    }.takeIf { it >= 0 } ?: groups.indexOfLast {
        focusTime >= it.main.startTimeMs
    }
    val interludeInsertionIndex = activeInterlude?.let { interlude ->
        groups.indexOfFirst { it.main.startTimeMs >= interlude.endTimeMs }
            .takeIf { it >= 0 } ?: groups.size
    }
    val listItems = remember(groups, activeInterlude?.startTimeMs, interludeInsertionIndex) {
        buildList {
            for (index in 0..groups.size) {
                if (activeInterlude != null && index == interludeInsertionIndex) {
                    add(
                        AmllLyricListItem.Interlude(
                            line = activeInterlude,
                            alignEnd =
                                index in groups.indices && groups[index].main.isDuet,
                        ),
                    )
                }
                if (index in groups.indices) {
                    add(AmllLyricListItem.Line(index, groups[index]))
                }
            }
        }
    }
    val focusedListIndex = when {
        activeInterlude != null && interludeInsertionIndex in groups.indices ->
            listItems.indexOfFirst {
                it is AmllLyricListItem.Line &&
                    it.sourceIndex == interludeInsertionIndex
            }
        activeInterlude != null ->
            listItems.indexOfFirst { it is AmllLyricListItem.Interlude }
        else ->
            listItems.indexOfFirst {
                it is AmllLyricListItem.Line &&
                    it.sourceIndex == naturalFocusIndex
            }
    }
    val listState = rememberLazyListState()

    when {
        lyrics.loading -> Box(
            Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }
        groups.isEmpty() -> Box(
            Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                lyrics.error ?: "暂无歌词",
                color = Color.White.copy(alpha = 0.58f),
            )
        }
        else -> BoxWithConstraints(Modifier.fillMaxSize()) {
            val lineGap = with(LocalDensity.current) { 9.6.sp.toDp() }
            LaunchedEffect(focusedListIndex, listItems.size) {
                if (focusedListIndex >= 0) {
                    listState.animateScrollToItem(
                        index = focusedListIndex,
                        scrollOffset = 0,
                    )
                }
            }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        compositingStrategy = CompositingStrategy.Offscreen
                    }
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            brush = Brush.verticalGradient(
                                0f to Color.Transparent,
                                0.10f to Color.Black,
                                0.86f to Color.Black,
                                1f to Color.Transparent,
                            ),
                            blendMode = BlendMode.DstIn,
                        )
                    },
                state = listState,
                contentPadding = PaddingValues(
                    start = 18.dp,
                    top = maxHeight * 0.37f,
                    end = 18.dp,
                    bottom = maxHeight * 0.57f,
                ),
                verticalArrangement = Arrangement.spacedBy(lineGap),
            ) {
                itemsIndexed(
                    items = listItems,
                    key = { _, item ->
                        when (item) {
                            is AmllLyricListItem.Line ->
                                "line:${item.group.main.startTimeMs}:${item.sourceIndex}"
                            is AmllLyricListItem.Interlude ->
                                "interlude:${item.line.startTimeMs}"
                        }
                    },
                ) { _, item ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .animateItem(
                                fadeInSpec = tween(240),
                                placementSpec = spring(
                                    dampingRatio = 0.82f,
                                    stiffness = 190f,
                                ),
                                fadeOutSpec = tween(180),
                            ),
                    ) {
                        when (item) {
                            is AmllLyricListItem.Line -> {
                                val index = item.sourceIndex
                                val main = item.group.main
                                val overlapsPlayback =
                                    positionLong >= main.startTimeMs &&
                                        positionLong < main.endTimeMs
                                AmllLyricLineItem(
                                    group = item.group,
                                    positionMs = positionMs,
                                    active =
                                        activeInterlude == null &&
                                            (index == activeIndex || overlapsPlayback),
                                    distanceFromActive =
                                        if (activeIndex >= 0) {
                                            abs(index - activeIndex)
                                        } else {
                                            Int.MAX_VALUE
                                        },
                                    passed = activeIndex >= 0 && index < activeIndex,
                                    onClick = onSeek?.let { seek ->
                                        { seek(main.startTimeMs / 1000.0) }
                                    },
                                )
                            }
                            is AmllLyricListItem.Interlude -> {
                                AmllActiveInterludeDots(
                                    line = item.line,
                                    positionMs = positionMs,
                                    alignEnd = item.alignEnd,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AmllLyricLineItem(
    group: AmllLyricGroup,
    positionMs: Float,
    active: Boolean,
    distanceFromActive: Int,
    passed: Boolean,
    onClick: (() -> Unit)?,
) {
    val line = group.main
    val alignment = if (line.isDuet) Alignment.End else Alignment.Start
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val scale by animateFloatAsState(
        targetValue = when {
            active -> 1f
            distanceFromActive <= 1 -> 0.96f
            else -> 0.92f
        },
        animationSpec = spring(dampingRatio = 0.82f, stiffness = 190f),
        label = "amllLineScale",
    )
    val alpha by animateFloatAsState(
        targetValue = when {
            active -> 1f
            passed && distanceFromActive > 1 -> 0.18f
            distanceFromActive == 1 -> 0.54f
            distanceFromActive == 2 -> 0.34f
            else -> 0.22f
        },
        animationSpec = tween(380),
        label = "amllLineAlpha",
    )
    val blurRadius by animateDpAsState(
        targetValue = when {
            active -> 0.dp
            distanceFromActive <= 1 -> 0.5.dp
            distanceFromActive == 2 -> 1.3.dp
            else -> 2.4.dp
        },
        animationSpec = tween(380),
        label = "amllLineBlur",
    )
    val mainWeight = if (active) FontWeight.Bold else FontWeight.SemiBold

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onClick,
                    )
                } else {
                    Modifier
                },
            )
            .blur(blurRadius, edgeTreatment = BlurredEdgeTreatment.Unbounded)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                this.alpha = alpha
                transformOrigin =
                    if (line.isDuet) TransformOrigin(1f, 0f) else TransformOrigin(0f, 0f)
            },
        horizontalAlignment = alignment,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        AmllWordRow(
            line = line,
            positionMs = positionMs,
            active = active,
            fontSize = 24f,
            fontWeight = mainWeight,
        )
        line.translatedLyric.takeIf { it.isNotBlank() }?.let { translated ->
            Text(
                text = translated,
                modifier = Modifier.fillMaxWidth(),
                textAlign = textAlign,
                fontSize = 14.sp,
                lineHeight = 18.sp,
                color = Color.White.copy(alpha = if (active) 0.66f else 0.48f),
            )
        }
        line.romanLyric
            .takeIf { it.isNotBlank() && line.words.none { word -> word.romanText.isNotBlank() } }
            ?.let { roman ->
                Text(
                    text = roman,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = textAlign,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = Color.White.copy(alpha = if (active) 0.50f else 0.38f),
                )
            }

        if (group.backgrounds.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth(0.74f)
                    .padding(top = 1.dp),
                horizontalAlignment = alignment,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                group.backgrounds.forEach { background ->
                    val backgroundActive =
                        positionMs >= background.startTimeMs && positionMs < background.endTimeMs
                    AmllWordRow(
                        line = background,
                        positionMs = positionMs,
                        active = backgroundActive,
                        fontSize = 17f,
                        fontWeight = FontWeight.SemiBold,
                        subdued = true,
                    )
                }
            }
        }
    }
}

private data class AmllWordChunk(
    val words: List<LyricWord>,
    val isTerminal: Boolean = false,
) {
    val text: String get() = words.joinToString("") { it.text }
    val startTimeMs: Long get() = words.minOf { it.startTimeMs }
    val endTimeMs: Long get() = words.maxOf { it.endTimeMs }
}

private data class AmllEmphasisProfile(
    val durationMs: Long,
    val amount: Float,
    val blur: Float,
)

private fun splitTimedGlyphs(word: LyricWord): List<LyricWord> {
    val iterator = BreakIterator.getCharacterInstance(Locale.ROOT)
    iterator.setText(word.text)
    val graphemes = buildList {
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            add(word.text.substring(start, end))
            start = end
            end = iterator.next()
        }
    }
    if (graphemes.size <= 1) return listOf(word)

    val duration = (word.endTimeMs - word.startTimeMs).coerceAtLeast(0L)
    return graphemes.mapIndexed { index, grapheme ->
        word.copy(
            text = grapheme,
            startTimeMs = word.startTimeMs + duration * index / graphemes.size,
            endTimeMs = word.startTimeMs + duration * (index + 1) / graphemes.size,
            romanText = "",
        )
    }
}

private fun amllEmphasisProfile(chunk: AmllWordChunk): AmllEmphasisProfile {
    val baseDuration = (chunk.endTimeMs - chunk.startTimeMs).coerceAtLeast(1_000L)
    val normalizedAmount = baseDuration / 2_000f
    var amount = if (normalizedAmount > 1f) {
        sqrt(normalizedAmount)
    } else {
        normalizedAmount.pow(3)
    } * 0.6f
    val normalizedBlur = baseDuration / 3_000f
    var blur = if (normalizedBlur > 1f) {
        sqrt(normalizedBlur)
    } else {
        normalizedBlur.pow(3)
    } * 0.5f
    var animationDuration = baseDuration

    if (chunk.isTerminal) {
        amount *= 1.6f
        blur *= 1.5f
        animationDuration = (animationDuration * 1.2f).roundToInt().toLong()
    }

    return AmllEmphasisProfile(
        durationMs = animationDuration,
        amount = amount.coerceAtMost(1.2f),
        blur = blur.coerceAtMost(0.8f),
    )
}

private fun isCjkText(value: String): Boolean {
    val content = value.filterNot(Char::isWhitespace)
    if (content.isEmpty()) return false
    return content.all { character ->
        Character.UnicodeScript.of(character.code) in setOf(
            Character.UnicodeScript.HAN,
            Character.UnicodeScript.HIRAGANA,
            Character.UnicodeScript.KATAKANA,
            Character.UnicodeScript.HANGUL,
        )
    }
}

private fun shouldEmphasizeWord(word: LyricWord): Boolean {
    val text = word.text.trim()
    val duration = word.endTimeMs - word.startTimeMs
    if (text.isEmpty() || duration < 1_000L) return false
    return isCjkText(text) || text.length in 2..7
}

/**
 * Mirrors AMLL's chunkAndSplitLyricWords: whitespace remains an explicit
 * boundary while adjacent non-CJK fragments without spaces become one visual
 * word. A terminal CJK sustain is additionally grouped so its characters can
 * enter independently and then hold one shared release point.
 */
private fun chunkAmllWords(line: LyricLine): List<AmllWordChunk> {
    val atoms = mutableListOf<LyricWord>()
    val partRegex = Regex("""\s+|\S+""")
    line.words.forEach { source ->
        val parts = partRegex.findAll(source.text).map { it.value }.toList()
        val totalUnits = source.text.count { !it.isWhitespace() }.coerceAtLeast(1)
        val timePerUnit =
            (source.endTimeMs - source.startTimeMs).coerceAtLeast(0L).toDouble() / totalUnits
        var currentOffset = 0

        parts.forEach { part ->
            val partStart = source.startTimeMs + (currentOffset * timePerUnit).toLong()
            if (part.isBlank()) {
                atoms += source.copy(
                    text = part,
                    startTimeMs = partStart,
                    endTimeMs = partStart,
                    romanText = "",
                )
            } else if (isCjkText(part) && part.length > 1 && source.romanText.isBlank()) {
                part.forEach { character ->
                    val start = source.startTimeMs + (currentOffset * timePerUnit).toLong()
                    atoms += source.copy(
                        text = character.toString(),
                        startTimeMs = start,
                        endTimeMs = source.startTimeMs +
                            ((currentOffset + 1) * timePerUnit).toLong(),
                        romanText = "",
                    )
                    currentOffset += 1
                }
            } else {
                val unitCount = part.count { !it.isWhitespace() }.coerceAtLeast(1)
                atoms += source.copy(
                    text = part,
                    startTimeMs = partStart,
                    endTimeMs = source.startTimeMs +
                        ((currentOffset + unitCount) * timePerUnit).toLong(),
                )
                currentOffset += unitCount
            }
        }
    }

    val chunks = mutableListOf<AmllWordChunk>()
    var mergeable = mutableListOf<LyricWord>()
    fun flushMergeable() {
        if (mergeable.isNotEmpty()) {
            chunks += AmllWordChunk(mergeable)
            mergeable = mutableListOf()
        }
    }

    atoms.forEach { atom ->
        val canMerge =
            atom.text.isNotBlank() &&
                atom.romanText.isBlank() &&
                !isCjkText(atom.text)
        if (canMerge) {
            mergeable += atom
        } else {
            flushMergeable()
            chunks += AmllWordChunk(listOf(atom))
        }
    }
    flushMergeable()

    val lastTextIndex = chunks.indexOfLast { it.text.isNotBlank() }
    if (lastTextIndex < 0) return chunks

    var terminalStart = lastTextIndex
    while (
        terminalStart > 0 &&
        lastTextIndex - terminalStart < 3 &&
        isCjkText(chunks[terminalStart - 1].text) &&
        isCjkText(chunks[terminalStart].text) &&
        chunks[terminalStart].startTimeMs - chunks[terminalStart - 1].endTimeMs <= 160L
    ) {
        terminalStart -= 1
    }
    val terminalChunks = chunks.subList(terminalStart, lastTextIndex + 1)
    val shouldMergeTerminal =
        terminalChunks.size > 1 &&
            terminalChunks.any { chunk -> chunk.words.any(::shouldEmphasizeWord) } &&
            line.endTimeMs - terminalChunks.last().endTimeMs <= 350L

    if (shouldMergeTerminal) {
        val result = mutableListOf<AmllWordChunk>()
        result += chunks.subList(0, terminalStart)
        result += AmllWordChunk(
            words = terminalChunks.flatMap { it.words },
            isTerminal = true,
        )
        result += chunks.subList(lastTextIndex + 1, chunks.size)
        return result
    }

    return chunks.mapIndexed { index, chunk ->
        chunk.copy(isTerminal = index == lastTextIndex)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AmllWordRow(
    line: LyricLine,
    positionMs: Float,
    active: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    subdued: Boolean = false,
) {
    val hasWordTiming = line.words.size > 1 && line.words
        .map { it.startTimeMs to it.endTimeMs }
        .distinct()
        .size > 1
    val hasRuby = line.words.any { it.romanText.isNotBlank() }
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val density = LocalDensity.current
    val emphasisHeadroom = with(density) { (fontSize * 0.16f).sp.toDp() }
    val wrappedLineGap = with(density) { (fontSize * 0.12f).sp.toDp() }

    if (!hasWordTiming) {
        line.words.singleOrNull()?.romanText?.takeIf { it.isNotBlank() }?.let { roman ->
            Text(
                text = roman,
                modifier = Modifier.fillMaxWidth(),
                textAlign = textAlign,
                color = Color.White.copy(alpha = 0.50f),
                fontSize = (fontSize * 0.46f).sp,
                lineHeight = (fontSize * 0.52f).sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Text(
            text = line.text,
            modifier = Modifier.fillMaxWidth(),
            textAlign = textAlign,
            color = Color.White.copy(alpha = if (active) 1f else if (subdued) 0.72f else 1f),
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
        )
        return
    }

    val chunks = remember(line.words, line.endTimeMs) { chunkAmllWords(line) }
    FlowRow(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = emphasisHeadroom),
        horizontalArrangement =
            if (line.isDuet) Arrangement.End else Arrangement.Start,
        verticalArrangement = Arrangement.spacedBy(wrappedLineGap),
    ) {
        chunks.forEach { chunk ->
            if (chunk.text.isBlank()) {
                Text(
                    text = chunk.text,
                    fontSize = fontSize.sp,
                    lineHeight = (fontSize * 1.25f).sp,
                )
            } else {
                AmllKaraokeChunk(
                    chunk = chunk,
                    lineEndTimeMs = line.endTimeMs,
                    positionMs = positionMs,
                    active = active,
                    reserveRubySpace = hasRuby,
                    fontSize = fontSize,
                    fontWeight = fontWeight,
                    subdued = subdued,
                )
            }
        }
    }
}

@Composable
private fun AmllKaraokeChunk(
    chunk: AmllWordChunk,
    lineEndTimeMs: Long,
    positionMs: Float,
    active: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    subdued: Boolean,
) {
    val mergedWord = remember(chunk.words) {
        LyricWord(
            text = chunk.text,
            startTimeMs = chunk.startTimeMs,
            endTimeMs = chunk.endTimeMs,
        )
    }
    val shouldEmphasize =
        chunk.words.any(::shouldEmphasizeWord) ||
            (!isCjkText(chunk.text) && shouldEmphasizeWord(mergedWord))
    val holdUntil = if (chunk.isTerminal) {
        maxOf(chunk.endTimeMs, lineEndTimeMs)
    } else {
        chunk.endTimeMs
    }
    val emphasisProfile = remember(chunk) { amllEmphasisProfile(chunk) }
    val glyphsByWord = remember(chunk.words) { chunk.words.map(::splitTimedGlyphs) }
    val glyphCount = glyphsByWord.sumOf(List<LyricWord>::size).coerceAtLeast(1)
    val glyphOffsets = remember(glyphsByWord) {
        var offset = 0
        glyphsByWord.map { glyphs ->
            offset.also { offset += glyphs.size }
        }
    }
    val inlineGuard = with(LocalDensity.current) { (fontSize * 0.14f).sp.toDp() }

    Row(
        modifier = Modifier.padding(
            horizontal = if (shouldEmphasize) inlineGuard else 0.dp,
        ),
        verticalAlignment = Alignment.Bottom,
    ) {
        chunk.words.forEachIndexed { index, word ->
            val glyphs = glyphsByWord[index]
            AmllKaraokeGlyph(
                word = word,
                timedGlyphs = glyphs,
                positionMs = positionMs,
                active = active,
                reserveRubySpace = reserveRubySpace,
                fontSize = fontSize,
                fontWeight = fontWeight,
                subdued = subdued,
                emphasize = shouldEmphasize,
                chunkStartTimeMs = chunk.startTimeMs,
                holdUntilMs = holdUntil,
                emphasisProfile = emphasisProfile,
                glyphIndexOffset = glyphOffsets[index],
                glyphCount = glyphCount,
            )
        }
    }
}

@Composable
private fun AmllKaraokeGlyph(
    word: LyricWord,
    timedGlyphs: List<LyricWord>,
    positionMs: Float,
    active: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    subdued: Boolean,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    holdUntilMs: Long,
    emphasisProfile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (reserveRubySpace) {
            Text(
                text = word.romanText.ifBlank { " " },
                color = Color.White.copy(alpha = if (word.romanText.isBlank()) 0f else 0.52f),
                fontSize = (fontSize * 0.46f).sp,
                lineHeight = (fontSize * 0.50f).sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
        Row(verticalAlignment = Alignment.Bottom) {
            timedGlyphs.forEachIndexed { index, glyph ->
                AmllKaraokeCharacter(
                    glyph = glyph,
                    positionMs = positionMs,
                    active = active,
                    fontSize = fontSize,
                    fontWeight = fontWeight,
                    subdued = subdued,
                    emphasize = emphasize,
                    chunkStartTimeMs = chunkStartTimeMs,
                    holdUntilMs = holdUntilMs,
                    emphasisProfile = emphasisProfile,
                    glyphIndex = glyphIndexOffset + index,
                    glyphCount = glyphCount,
                )
            }
        }
    }
}

@Composable
private fun AmllKaraokeCharacter(
    glyph: LyricWord,
    positionMs: Float,
    active: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    subdued: Boolean,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    holdUntilMs: Long,
    emphasisProfile: AmllEmphasisProfile,
    glyphIndex: Int,
    glyphCount: Int,
) {
    val highlightProgress = if (active) wordProgress(glyph, positionMs) else 0f
    val baseAlpha = if (active) {
        if (subdued) 0.22f else 0.25f
    } else {
        if (subdued) 0.72f else 1f
    }
    val staggerMs = emphasisProfile.durationMs.toFloat() / 2.5f / glyphCount
    val staggeredStartMs = chunkStartTimeMs + (staggerMs * glyphIndex).toLong()
    val entryTimeMs = maxOf(glyph.startTimeMs, staggeredStartMs)
    val inEmphasisWindow =
        active &&
            emphasize &&
            positionMs >= entryTimeMs &&
            positionMs < holdUntilMs
    val elapsedFraction =
        ((positionMs - entryTimeMs) / emphasisProfile.durationMs)
            .coerceIn(0f, 1f)
    val easedTarget = if (inEmphasisWindow) {
        elapsedFraction * elapsedFraction * (3f - 2f * elapsedFraction)
    } else {
        0f
    }
    val emphasis by animateFloatAsState(
        targetValue = easedTarget,
        animationSpec = tween(
            durationMillis = if (inEmphasisWindow) 90 else 180,
            easing = LinearEasing,
        ),
        label = "amllCharacterEmphasis",
    )
    val floatTarget = if (inEmphasisWindow) {
        sin((elapsedFraction / 1.4f).coerceIn(0f, 1f) * PI).toFloat()
    } else {
        0f
    }
    val floatLift by animateFloatAsState(
        targetValue = floatTarget,
        animationSpec = tween(
            durationMillis = if (inEmphasisWindow) 90 else 180,
            easing = LinearEasing,
        ),
        label = "amllCharacterFloat",
    )
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val centerOffset = glyphCount / 2f - glyphIndex
    val glowLevel = (emphasis * emphasisProfile.blur).coerceIn(0f, 0.8f)
    val glowRadius =
        fontSizePx * minOf(0.3f, emphasisProfile.blur * 0.3f) * emphasis

    Box(
        modifier = Modifier.graphicsLayer {
            val scale = 1f + emphasis * 0.1f * emphasisProfile.amount
            scaleX = scale
            scaleY = scale
            translationX =
                -emphasis * 0.03f * emphasisProfile.amount * centerOffset * fontSizePx
            translationY =
                -(emphasis * 0.025f * emphasisProfile.amount + floatLift * 0.05f) *
                    fontSizePx
            transformOrigin = TransformOrigin(0.5f, 0.5f)
        },
    ) {
        Text(
            text = glyph.text,
            color = Color.White.copy(alpha = baseAlpha),
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
            maxLines = 1,
        )
        Text(
            text = glyph.text,
            color = Color.White,
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
            maxLines = 1,
            style = TextStyle(
                shadow = Shadow(
                    color = Color.White.copy(alpha = glowLevel),
                    blurRadius = glowRadius,
                ),
            ),
            modifier = Modifier
                .graphicsLayer {
                    compositingStrategy = CompositingStrategy.Offscreen
                    alpha = if (subdued) 0.84f else 1f
                }
                .drawWithContent {
                    when {
                        highlightProgress <= 0f -> Unit
                        highlightProgress >= 1f -> drawContent()
                        else -> {
                            drawContent()
                            val feather = (fontSizePx * 0.5f / size.width.coerceAtLeast(1f))
                                .coerceIn(0.04f, 0.22f)
                            val solidEnd = (highlightProgress - feather).coerceAtLeast(0f)
                            drawRect(
                                brush = Brush.horizontalGradient(
                                    0f to Color.Black,
                                    solidEnd to Color.Black,
                                    highlightProgress to Color.Transparent,
                                    1f to Color.Transparent,
                                ),
                                blendMode = BlendMode.DstIn,
                            )
                        }
                    }
                },
        )
    }
}

private fun amllEaseInOutBack(value: Float): Float {
    val x = value.coerceIn(0f, 1f)
    val c1 = 1.70158f
    val c2 = c1 * 1.525f
    return if (x < 0.5f) {
        ((2f * x).pow(2) * ((c2 + 1f) * 2f * x - c2)) / 2f
    } else {
        ((2f * x - 2f).pow(2) * ((c2 + 1f) * (2f * x - 2f) + c2) + 2f) / 2f
    }
}

@Composable
private fun AmllActiveInterludeDots(
    line: LyricLine,
    positionMs: Float,
    alignEnd: Boolean,
    modifier: Modifier = Modifier,
) {
    val duration = (line.endTimeMs - line.startTimeMs).coerceAtLeast(1L).toFloat()
    val elapsed = (positionMs - line.startTimeMs).coerceIn(0f, duration)
    val remaining = (duration - elapsed).coerceAtLeast(0f)
    val dotTimeline = (duration - 750f).coerceAtLeast(1f)
    val fadeIn = ((elapsed - 500f) / 500f).coerceIn(0f, 1f)
    val fadeOut = (remaining / 375f).coerceIn(0f, 1f)
    val globalAlpha = minOf(fadeIn, fadeOut)
    val breatheDuration = duration / kotlin.math.ceil(duration / 1_500f).coerceAtLeast(1f)
    val breathe = 1f +
        sin(1.5f * PI.toFloat() - (elapsed / breatheDuration) * 2f) / 20f
    val enterScale = if (elapsed < 2_000f) {
        1f - 2f.pow(-10f * (elapsed / 2_000f).coerceIn(0f, 1f))
    } else {
        1f
    }
    val exitScale = if (remaining < 750f) {
        1f - amllEaseInOutBack(
            ((750f - remaining) / 750f / 2f).coerceIn(0f, 0.5f),
        )
    } else {
        1f
    }
    val scale = (breathe * enterScale * exitScale * 0.7f).coerceAtLeast(0f)
    val dotAlphas = List(3) { index ->
        val offset = dotTimeline / 3f * index
        (((elapsed - offset) * 3f / dotTimeline) * 0.75f + 0.25f)
            .coerceIn(0.25f, 1f) * globalAlpha
    }
    val density = LocalDensity.current
    val dotSize = with(density) { 12.sp.toDp() }
    val dotGap = with(density) { 6.sp.toDp() }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(dotSize),
        contentAlignment = if (alignEnd) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier
                .widthIn(min = dotSize * 3 + dotGap * 2)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                },
            horizontalArrangement = Arrangement.spacedBy(dotGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(3) { index ->
                Box(
                    Modifier
                        .size(dotSize)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = dotAlphas[index])),
                )
            }
        }
    }
}


/**
 * 把 NativePlayer 每 250ms 推送一次的 [rawPositionMs] 在 Compose 帧内插值为连续值。
 * 关键：用 [withFrameNanos] 按 60fps 推进内部 tick，让逐字扫光与行上浮在外部采样之间也是连续的。
 *
 * - 当 [rawPositionMs] 与内部位置差 > 2s（seek / 切歌）直接 snap；
 * - 暂停时停止 tick，position 锁定在最后一次 rawPositionMs；
 * - 播放时每帧叠加 (now - last) ms，外部更新时再 snap 修正漂移。
 */
@Composable
private fun rememberSmoothPositionMs(rawPositionMs: Float, isPlaying: Boolean): Float {
    val position = remember { mutableFloatStateOf(rawPositionMs) }

    // 外部采样到来：先记录基准，再让 tick 在两帧之间追赶，避免漂移
    LaunchedEffect(rawPositionMs) {
        val delta = kotlin.math.abs(rawPositionMs - position.floatValue)
        if (delta > 2_000f) {
            position.floatValue = rawPositionMs
        } else if (!isPlaying) {
            // 暂停时直接把内部位置对齐到 raw，避免切到播放时跳一大截
            position.floatValue = rawPositionMs
        }
    }

    LaunchedEffect(isPlaying) {
        if (!isPlaying) return@LaunchedEffect
        var lastNanos = 0L
        while (true) {
            withFrameNanos { nanos ->
                if (lastNanos == 0L) {
                    lastNanos = nanos
                    return@withFrameNanos
                }
                val dtMs = (nanos - lastNanos) / 1_000_000f
                lastNanos = nanos
                // 正常推进：内部位置按帧间隔累加
                position.floatValue = position.floatValue + dtMs
            }
        }
    }
    return position.floatValue
}

/** 计算某个字在当前播放位置下的填充比例，0=未播放，1=已播放完。 */
private fun wordProgress(word: LyricWord, positionMs: Float): Float {
    val start = word.startTimeMs.toFloat()
    val end = word.endTimeMs.toFloat()
    if (positionMs <= start) return 0f
    if (positionMs >= end) return 1f
    val span = (end - start).coerceAtLeast(1f)
    return ((positionMs - start) / span).coerceIn(0f, 1f)
}

private fun formatTime(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0) return "--:--"
    val total = seconds.roundToInt()
    return "%d:%02d".format(total / 60, total % 60)
}

private fun formatMessageTime(timestamp: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))

private fun roleLabel(role: String): String = when (role) {
    "owner" -> "房主"
    "admin" -> "管理员"
    else -> "成员"
}

private fun voteActionLabel(action: String): String = when (action) {
    "pause" -> "暂停"
    "resume" -> "继续播放"
    "next" -> "下一首"
    "prev" -> "上一首"
    "set-mode" -> "切换播放模式"
    "play-track" -> "播放歌曲"
    "remove-track" -> "移除歌曲"
    else -> action
}
