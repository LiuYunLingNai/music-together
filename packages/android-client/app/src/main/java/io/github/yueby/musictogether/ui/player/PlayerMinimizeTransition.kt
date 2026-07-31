package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedContent
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

@Composable
internal fun PlayerMinimizeTransitionHost(
    roomId: String?,
    showHome: Boolean,
    minimizedTarget: Boolean,
    modifier: Modifier = Modifier,
    homeContent: @Composable () -> Unit,
    playerContent: @Composable () -> Unit,
) {
    AnimatedContent(
        targetState = showHome,
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
        label = "room-minimized-player-container",
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
