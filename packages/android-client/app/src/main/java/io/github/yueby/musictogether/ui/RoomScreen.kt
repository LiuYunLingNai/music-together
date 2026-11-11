package io.github.yueby.musictogether.ui

import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.expandVertically
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.ui.player.PlayerPane
import kotlinx.coroutines.delay

internal enum class RoomBackAction {
    DismissMenu,
    MinimizePlayer,
}

internal fun resolveRoomBackAction(roomMenuExpanded: Boolean): RoomBackAction =
    if (roomMenuExpanded) RoomBackAction.DismissMenu else RoomBackAction.MinimizePlayer

@Composable
fun RoomScreen(
    appState: AppState,
    outerPadding: PaddingValues,
    viewModel: MusicTogetherViewModel,
    shellOnTop: Boolean,
    onMinimizePlayer: () -> Unit,
) {
    val room = appState.room ?: return
    val navigator = LocalAppNavigator.current
    var landscapeChromeVisible by remember(room.id) { mutableStateOf(true) }
    var roomMenuExpanded by remember(room.id) { mutableStateOf(false) }
    val layoutDirection = LocalLayoutDirection.current
    val openRoute: (AppRoute) -> Unit = { route ->
        roomMenuExpanded = false
        landscapeChromeVisible = false
        navigator.open(route)
    }

    BackHandler(enabled = shellOnTop) {
        when (resolveRoomBackAction(roomMenuExpanded)) {
            RoomBackAction.DismissMenu -> roomMenuExpanded = false
            RoomBackAction.MinimizePlayer -> onMinimizePlayer()
        }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize().background(Color(0xFF080A0F))) {
        val landscape = maxWidth > maxHeight
        val headerVisible = !landscape || landscapeChromeVisible

        LaunchedEffect(landscape, landscapeChromeVisible, roomMenuExpanded, shellOnTop) {
            if (landscape && landscapeChromeVisible && !roomMenuExpanded && shellOnTop) {
                delay(3_500)
                landscapeChromeVisible = false
            }
        }
        LaunchedEffect(landscape) {
            if (landscape) landscapeChromeVisible = true
        }

        val stageTop by animateDpAsState(
            if (headerVisible) 0.dp else outerPadding.calculateTopPadding() + 8.dp,
            tween(220),
            label = "stage-top",
        )
        val stageShape = RoundedCornerShape(24.dp)
        Column(Modifier.fillMaxSize()) {
            AnimatedVisibility(
                visible = headerVisible,
                enter = fadeIn(tween(220)) + expandVertically(tween(260)),
                exit = fadeOut(tween(180)) + shrinkVertically(tween(220)),
            ) {
                RoomHeader(
                    room = room,
                    safeContentPadding = outerPadding,
                    menuExpanded = roomMenuExpanded,
                    onMenuExpandedChange = {
                        roomMenuExpanded = it
                        if (it) landscapeChromeVisible = true
                    },
                    connectionStatus = appState.connectionStatus,
                    pingMs = appState.pingMs,
                    viewModel = viewModel,
                    onMinimizePlayer = onMinimizePlayer,
                    onOpenMembers = { openRoute(AppRoute.Members) },
                    onOpenRoute = openRoute,
                )
            }
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(
                        start = outerPadding.calculateLeftPadding(layoutDirection) + 8.dp,
                        end = outerPadding.calculateRightPadding(layoutDirection) + 8.dp,
                        top = stageTop,
                        bottom = outerPadding.calculateBottomPadding() + 8.dp,
                    )
                    .clip(stageShape)
                    .border(1.dp, Color.White.copy(alpha = 0.10f), stageShape),
            ) {
                PlayerPane(
                    room = room,
                    lyrics = appState.lyrics,
                    lyricOffsets = appState.lyricOffsets,
                    activeVote = appState.activeVote,
                    userId = appState.userId,
                    chatUnreadCount = appState.chatUnreadCount,
                    visualMotionEnabled = shellOnTop,
                    viewModel = viewModel,
                    immersiveLandscape = landscape,
                    safeContentPadding = PaddingValues(0.dp),
                    onSurfaceTap = {
                        if (landscape) landscapeChromeVisible = !landscapeChromeVisible
                    },
                    onOpenQueue = { openRoute(AppRoute.Queue) },
                    onOpenChat = { openRoute(AppRoute.Chat) },
                    onOpenArtist = navigator::openArtist,
                )
            }
        }
    }
}
