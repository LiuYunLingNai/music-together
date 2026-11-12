package io.github.yueby.musictogether.ui.player

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Repeat
import com.composables.icons.lucide.Repeat1
import com.composables.icons.lucide.Shuffle
import com.composables.icons.lucide.ArrowRightToLine
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Icon

private val PlayModeCycle = listOf("sequential", "loop-all", "loop-one", "shuffle")

/** Web play-mode button: each tap advances sequential → loop-all → loop-one → shuffle. */
@Composable
internal fun PlayModeButton(
    playMode: String,
    scale: Float,
    modifier: Modifier = Modifier,
    onModeSelected: (String) -> Unit,
) {
    val mode = playMode.takeIf { it in PlayModeCycle } ?: "sequential"
    StageButton(
        onClick = { onModeSelected(PlayModeCycle[(PlayModeCycle.indexOf(mode) + 1) % PlayModeCycle.size]) },
        modifier = modifier.size((36f * scale).dp),
    ) {
        AnimatedContent(
            targetState = mode,
            transitionSpec = {
                (fadeIn(tween(150)) + scaleIn(tween(150), initialScale = 0.6f)) togetherWith
                    (fadeOut(tween(150)) + scaleOut(tween(150), targetScale = 0.6f))
            },
            label = "play-mode-icon",
        ) { current ->
            Icon(
                imageVector = when (current) {
                    "loop-all" -> Lucide.Repeat
                    "loop-one" -> Lucide.Repeat1
                    "shuffle" -> Lucide.Shuffle
                    else -> Lucide.ArrowRightToLine
                },
                contentDescription = when (current) {
                    "loop-all" -> "列表循环"
                    "loop-one" -> "单曲循环"
                    "shuffle" -> "随机播放"
                    else -> "顺序播放"
                },
                modifier = Modifier.size((20f * scale).dp),
                tint = Color.White.copy(alpha = 0.75f),
            )
        }
    }
}
