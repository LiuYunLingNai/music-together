package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class PlayModeMenuItem(
    val mode: String,
    val label: String,
    val icon: ImageVector,
)

private val PlayModeMenuItems = listOf(
    PlayModeMenuItem("shuffle", "随机播放", Icons.Default.Shuffle),
    PlayModeMenuItem("sequential", "顺序播放", Icons.Default.VerticalAlignTop),
    PlayModeMenuItem("loop-all", "列表循环", Icons.Default.Repeat),
    PlayModeMenuItem("loop-one", "单曲循环", Icons.Default.RepeatOne),
)

@Composable
internal fun PlayModeMenuButton(
    playMode: String,
    enabled: Boolean,
    scale: Float,
    modifier: Modifier = Modifier,
    onModeSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val currentItem =
        PlayModeMenuItems.firstOrNull { it.mode == playMode }
            ?: PlayModeMenuItems.first { it.mode == "sequential" }
    val menuScale = scale.coerceIn(0.86f, 1.18f)
    val menuWidth = (196f * menuScale).coerceIn(176f, 220f).dp
    val rowFontSize = (16f * menuScale).coerceIn(14f, 17f).sp
    val rowIconSize = (23f * menuScale).coerceIn(20f, 25f).dp

    Box(modifier) {
        IconButton(
            onClick = { expanded = true },
            enabled = enabled,
            modifier = Modifier.size((42f * scale).dp),
        ) {
            AnimatedContent(
                targetState = currentItem,
                transitionSpec = {
                    (
                        fadeIn(tween(150)) +
                            scaleIn(tween(150), initialScale = 0.6f)
                        ) togetherWith (
                        fadeOut(tween(120)) +
                            scaleOut(tween(120), targetScale = 0.6f)
                        )
                },
                label = "play-mode-menu-icon",
            ) { item ->
                Icon(
                    imageVector = item.icon,
                    contentDescription = "播放模式：${item.label}",
                    modifier = Modifier
                        .size((21f * scale).dp)
                        .graphicsLayer {
                            rotationZ = if (item.mode == "sequential") 90f else 0f
                        },
                    tint = Color.White.copy(alpha = if (enabled) 0.72f else 0.28f),
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.width(menuWidth),
            shape = RoundedCornerShape((18f * menuScale).dp),
            containerColor = Color(0xF21A1A1C),
            tonalElevation = 0.dp,
            shadowElevation = 14.dp,
        ) {
            PlayModeMenuItems.forEach { item ->
                val selected = item.mode == playMode
                DropdownMenuItem(
                    text = {
                        Text(
                            text = item.label,
                            color = Color.White.copy(alpha = if (selected) 0.98f else 0.84f),
                            fontSize = rowFontSize,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = item.icon,
                            contentDescription = null,
                            modifier = Modifier
                                .size(rowIconSize)
                                .graphicsLayer {
                                    rotationZ = if (item.mode == "sequential") 90f else 0f
                                },
                            tint = Color.White.copy(alpha = if (selected) 0.96f else 0.72f),
                        )
                    },
                    onClick = {
                        expanded = false
                        if (!selected) onModeSelected(item.mode)
                    },
                    modifier = Modifier
                        .clip(RoundedCornerShape((12f * menuScale).dp))
                        .background(
                            if (selected) Color.White.copy(alpha = 0.08f) else Color.Transparent,
                        ),
                    contentPadding = PaddingValues(
                        horizontal = (16f * menuScale).dp,
                        vertical = (2f * menuScale).dp,
                    ),
                )
            }
        }
    }
}
