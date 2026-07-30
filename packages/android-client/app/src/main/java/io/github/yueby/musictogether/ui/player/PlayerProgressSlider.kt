package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/**
 * Matches the upstream player track: a 6 px-equivalent rounded rail with a
 * normally hidden 16 px-equivalent thumb that appears while seeking.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PlayerProgressSlider(
    value: Float,
    maximumValue: Float,
    seeking: Boolean,
    enabled: Boolean,
    scale: Float,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val thumbAlpha by animateFloatAsState(
        targetValue = if (seeking && enabled) 1f else 0f,
        animationSpec = tween(durationMillis = 150),
        label = "player-progress-thumb-alpha",
    )
    BoxWithConstraints(
        modifier = modifier.height((20f * scale).dp),
        contentAlignment = Alignment.Center,
    ) {
        val halfThumbWidth = (8f * scale).dp
        Slider(
            value = value.coerceIn(0f, maximumValue),
            onValueChange = onValueChange,
            onValueChangeFinished = onValueChangeFinished,
            valueRange = 0f..maximumValue,
            enabled = enabled,
            modifier = Modifier
                .requiredWidth(maxWidth + halfThumbWidth * 2)
                .height((20f * scale).dp),
            thumb = {
                Box(
                    Modifier
                        .size((16f * scale).dp)
                        .graphicsLayer {
                            alpha = thumbAlpha
                        }
                        .shadow((2f * scale).dp, CircleShape)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border((1f * scale).dp, Color.White.copy(alpha = 0.50f), CircleShape),
                )
            },
            track = { sliderState ->
                SliderDefaults.Track(
                    sliderState = sliderState,
                    modifier = Modifier.height((6f * scale).dp),
                    colors = SliderDefaults.colors(
                        activeTrackColor = Color.White.copy(alpha = 0.70f),
                        inactiveTrackColor = Color.White.copy(alpha = 0.25f),
                    ),
                    thumbTrackGapSize = 0.dp,
                    trackInsideCornerSize = 0.dp,
                    drawStopIndicator = null,
                )
            },
        )
    }
}
