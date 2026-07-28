package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.player.PlayerPane
import kotlinx.coroutines.delay

internal enum class RoomOverlay {
    Queue, Search, Chat, Members, Accounts, AccountSettings, RoomSettings
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    appState: AppState,
    outerPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
) {
    val room = appState.room ?: return
    var activeOverlay by remember { mutableStateOf<RoomOverlay?>(null) }
    var landscapeChromeVisible by remember(room.id) { mutableStateOf(true) }
    var roomMenuExpanded by remember(room.id) { mutableStateOf(false) }
    val overlaySheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val navigateBack = {
        when {
            activeOverlay != null -> activeOverlay = null
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

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val landscape = maxWidth > maxHeight

        LaunchedEffect(landscape, landscapeChromeVisible, roomMenuExpanded, activeOverlay) {
            if (landscape && landscapeChromeVisible && !roomMenuExpanded && activeOverlay == null) {
                delay(3_500)
                landscapeChromeVisible = false
            }
        }
        LaunchedEffect(landscape) {
            if (landscape) landscapeChromeVisible = true
        }

        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .padding(if (landscape) PaddingValues(0.dp) else outerPadding),
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                if (!landscape) {
                    RoomHeader(
                        room = room,
                        immersive = false,
                        menuExpanded = roomMenuExpanded,
                        onMenuExpandedChange = { roomMenuExpanded = it },
                        viewModel = viewModel,
                        context = context,
                        onOpenOverlay = { activeOverlay = it },
                    )
                }
            },
        ) { padding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(if (landscape) PaddingValues(0.dp) else padding),
            ) {
                PlayerPane(
                    room = room,
                    lyrics = appState.lyrics,
                    lyricOffsets = appState.lyricOffsets,
                    activeVote = appState.activeVote,
                    userId = appState.userId,
                    viewModel = viewModel,
                    immersiveLandscape = landscape,
                    landscapeChromeVisible = landscapeChromeVisible,
                    safeContentPadding =
                        if (landscape) outerPadding else PaddingValues(0.dp),
                    onSurfaceTap = {
                        if (landscape) landscapeChromeVisible = !landscapeChromeVisible
                    },
                    onOpenQueue = { activeOverlay = RoomOverlay.Queue },
                    onOpenChat = { activeOverlay = RoomOverlay.Chat },
                )
                if (!landscape) appState.activeVote?.let { vote ->
                    val hasVoted = appState.userId?.let(vote.votes::containsKey) == true
                    val approveCount = vote.votes.values.count { it }
                    val rejectCount = vote.votes.values.count { !it }
                    Card(
                        Modifier
                            .align(Alignment.TopCenter)
                            .fillMaxWidth()
                            .padding(if (landscape) outerPadding else PaddingValues(0.dp))
                            .padding(12.dp),
                    ) {
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

                AnimatedVisibility(
                    visible = landscape && landscapeChromeVisible,
                    modifier = Modifier.align(Alignment.TopCenter),
                    enter = fadeIn(tween(220)) + slideInVertically(tween(260)) { -it / 3 },
                    exit = fadeOut(tween(180)) + slideOutVertically(tween(220)) { -it / 3 },
                ) {
                    RoomHeader(
                        room = room,
                        immersive = true,
                        safeContentPadding = outerPadding,
                        menuExpanded = roomMenuExpanded,
                        onMenuExpandedChange = {
                            roomMenuExpanded = it
                            if (it) landscapeChromeVisible = true
                        },
                        viewModel = viewModel,
                        context = context,
                        onOpenOverlay = {
                            landscapeChromeVisible = false
                            activeOverlay = it
                        },
                    )
                }
            }
        }

        activeOverlay?.let { overlay ->
            if (landscape && (overlay == RoomOverlay.Queue || overlay == RoomOverlay.Chat)) {
                LandscapeRoomSidePanel(
                    overlay = overlay,
                    room = room,
                    messages = appState.messages,
                    viewModel = viewModel,
                    safeContentPadding = outerPadding,
                    onDismiss = { activeOverlay = null },
                )
            } else {
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
    }
}
