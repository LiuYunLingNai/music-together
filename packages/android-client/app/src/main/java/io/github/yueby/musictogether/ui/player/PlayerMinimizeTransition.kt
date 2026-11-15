package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.rememberTransition
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier

internal data class PlayerMinimizeTransitionContext(
    val roomId: String,
    val minimizedTarget: Boolean,
    val transitionRunning: Boolean,
)

internal val LocalPlayerMinimizeTransition =
    compositionLocalOf<PlayerMinimizeTransitionContext?> { null }

/** Lets the system back gesture scrub the minimize transition before it commits. */
internal class PlayerMinimizeGesture(
    private val state: SeekableTransitionState<Boolean>,
    private val scope: CoroutineScope,
) {
    suspend fun preview(progress: Float) {
        if (!state.currentState) state.seekTo(progress.coerceIn(0f, 1f) * PREVIEW_DEPTH, targetState = true)
    }

    fun cancel() {
        scope.launch { state.animateTo(state.currentState) }
    }

    private companion object {
        const val PREVIEW_DEPTH = 0.35f
    }
}

internal val LocalPlayerMinimizeGesture = staticCompositionLocalOf<PlayerMinimizeGesture?> { null }

@Composable
internal fun PlayerMinimizeTransitionHost(
    roomId: String?,
    showHome: Boolean,
    minimizedTarget: Boolean,
    modifier: Modifier = Modifier,
    homeContent: @Composable () -> Unit,
    playerContent: @Composable () -> Unit,
) {
    val seekable = remember { SeekableTransitionState(showHome) }
    val scope = rememberCoroutineScope()
    val gesture = remember(seekable, scope) { PlayerMinimizeGesture(seekable, scope) }
    LaunchedEffect(showHome) { seekable.animateTo(showHome) }
    val hostTransition = rememberTransition(seekable, label = "room-minimized-player")
    CompositionLocalProvider(LocalPlayerMinimizeGesture provides gesture) {
    hostTransition.AnimatedContent(
        transitionSpec = {
            if (targetState) {
                (
                    fadeIn(
                        tween(
                            durationMillis = 250,
                            delayMillis = 45,
                            easing = LinearOutSlowInEasing,
                        ),
                    ) + slideInVertically(
                        tween(300, easing = LinearOutSlowInEasing),
                    ) { fullHeight -> fullHeight / 50 }
                    ) togetherWith (
                    fadeOut(tween(170)) + scaleOut(
                        targetScale = 0.975f,
                        animationSpec = tween(220, easing = LinearOutSlowInEasing),
                    )
                    )
            } else {
                (
                    fadeIn(
                        tween(230, easing = LinearOutSlowInEasing),
                    ) + scaleIn(
                        initialScale = 0.975f,
                        animationSpec = tween(280, easing = LinearOutSlowInEasing),
                    )
                    ) togetherWith (
                    fadeOut(tween(150)) + slideOutVertically(
                        tween(220, easing = LinearOutSlowInEasing),
                    ) { fullHeight -> fullHeight / 50 }
                    )
            }
        },
        modifier = modifier,
    ) { homeVisible ->
        CompositionLocalProvider(
            LocalPlayerMinimizeTransition provides roomId?.let {
                PlayerMinimizeTransitionContext(
                    roomId = it,
                    minimizedTarget = minimizedTarget,
                    transitionRunning = transition.isRunning,
                )
            },
        ) {
            if (homeVisible) homeContent() else playerContent()
        }
    }
    }
}
