package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun AmllTimestampPreview(
    geometry: AmllPreviewGeometry?,
    visible: Boolean,
    containerWidth: androidx.compose.ui.unit.Dp,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
    backgroundFontSize: Float,
    modifier: Modifier = Modifier,
) {
    var containerTopInRootPx by remember { mutableFloatStateOf(0f) }
    val group = geometry?.group
    val line = group?.main
    val timestampText = line?.let {
        formatLyricTimestamp(it.words.firstOrNull()?.startTimeMs ?: it.startTimeMs)
    }.orEmpty()
    val timestampFontSize = (mainFontSize * 0.42f).coerceAtLeast(10f)
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val hasRoom = remember(
        line,
        group?.background,
        timestampText,
        mainFontSize,
        translationFontSize,
        romanFontSize,
        backgroundFontSize,
        timestampFontSize,
        containerWidth,
        density,
    ) {
        fun measureWidth(text: String, style: TextStyle): Float {
            if (text.isBlank()) return 0f
            return textMeasurer.measure(
                text = text,
                style = style,
                softWrap = false,
                maxLines = 1,
            ).size.width.toFloat()
        }

        val lyricWidth = maxOf(
            measureWidth(
                line?.text.orEmpty(),
                TextStyle(
                    fontSize = mainFontSize.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            ),
            measureWidth(
                line?.translatedLyric.orEmpty(),
                TextStyle(fontSize = translationFontSize.sp),
            ),
            measureWidth(
                line?.romanLyric.orEmpty(),
                TextStyle(fontSize = romanFontSize.sp),
            ),
            measureWidth(
                group?.background?.text.orEmpty(),
                TextStyle(
                    fontSize = backgroundFontSize.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            ),
        )
        val timestampWidth = measureWidth(
            timestampText,
            TextStyle(
                fontSize = timestampFontSize.sp,
                fontWeight = FontWeight.Medium,
            ),
        )
        hasAmllLyricTimestampRoom(
            lyricWidthPx = lyricWidth,
            timestampWidthPx = timestampWidth,
            containerWidthPx = with(density) { containerWidth.toPx() },
            gapPx = with(density) { 12.dp.toPx() },
        )
    }

    Box(
        modifier.onGloballyPositioned { coordinates ->
            containerTopInRootPx = coordinates.positionInRoot().y
        },
    ) {
        AnimatedVisibility(
            visible = visible && geometry != null && hasRoom,
            modifier = Modifier
                .align(
                    if (line?.isDuet == true) Alignment.TopStart else Alignment.TopEnd,
                )
                .graphicsLayer {
                    translationY =
                        (geometry?.centerYInRootPx ?: 0f) -
                        containerTopInRootPx -
                        size.height / 2f
                },
            enter = fadeIn(tween(140)),
            exit = fadeOut(tween(180)),
        ) {
            Text(
                text = timestampText,
                color = Color.White.copy(alpha = 0.38f),
                fontSize = timestampFontSize.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}

/**
 * AMLL positions an inactive background vocal outside the main flow, then
 * progressively restores its measured height while the group becomes active.
 */
