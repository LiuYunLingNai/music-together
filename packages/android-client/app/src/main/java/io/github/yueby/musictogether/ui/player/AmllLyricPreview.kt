package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllLyricGroup

internal data class AmllPrimaryTextGeometry(
    val boundsInRoot: Rect,
    val visualLinesInRoot: List<Rect>,
) {
    companion object {
        fun fromVisualLines(visualLines: List<Rect>): AmllPrimaryTextGeometry {
            require(visualLines.isNotEmpty())
            return AmllPrimaryTextGeometry(
                boundsInRoot = Rect(
                    left = visualLines.minOf(Rect::left),
                    top = visualLines.minOf(Rect::top),
                    right = visualLines.maxOf(Rect::right),
                    bottom = visualLines.maxOf(Rect::bottom),
                ),
                visualLinesInRoot = visualLines,
            )
        }
    }
}

internal data class AmllPreviewGeometry(
    val primaryText: AmllPrimaryTextGeometry,
    val groupBoundsInRoot: Rect,
    val group: AmllLyricGroup,
)

private data class AmllTimestampRenderState(
    val text: String,
    val xInRootPx: Float,
    val centerYInRootPx: Float,
)

internal fun amllFixedTimestampXInRoot(
    visualLine: Rect,
    timestampWidthPx: Float,
    containerBoundsInRoot: Rect,
    horizontalInsetPx: Float,
    gapPx: Float,
    preferLeft: Boolean,
): Float? {
    val leftLimit = containerBoundsInRoot.left + horizontalInsetPx.coerceAtLeast(0f)
    val rightLimit = containerBoundsInRoot.right - horizontalInsetPx.coerceAtLeast(0f)
    val timestampWidth = timestampWidthPx.coerceAtLeast(0f)
    val gap = gapPx.coerceAtLeast(0f)
    return if (preferLeft) {
        leftLimit.takeIf { fixedX ->
            fixedX + timestampWidth + gap <= visualLine.left
        }
    } else {
        (rightLimit - timestampWidth).takeIf { fixedX ->
            visualLine.right + gap <= fixedX
        }
    }
}

@Composable
internal fun AmllTimestampPreview(
    geometry: AmllPreviewGeometry?,
    visible: Boolean,
    mainFontSize: Float,
    modifier: Modifier = Modifier,
) {
    var containerBoundsInRoot by remember { mutableStateOf(Rect.Zero) }
    val line = geometry?.group?.main
    val timestampText = line?.let {
        formatLyricTimestamp(it.words.firstOrNull()?.startTimeMs ?: it.startTimeMs)
    }.orEmpty()
    val timestampFontSize = (mainFontSize * 0.42f).coerceAtLeast(10f)
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val timestampWidth = remember(timestampText, timestampFontSize) {
        textMeasurer.measure(
            text = timestampText,
            style = TextStyle(
                fontSize = timestampFontSize.sp,
                fontWeight = FontWeight.Medium,
            ),
            softWrap = false,
            maxLines = 1,
        ).size.width.toFloat()
    }
    val targetVisualLine = geometry?.primaryText?.visualLinesInRoot?.lastOrNull()
    val timestampX = targetVisualLine?.let { visualLine ->
        amllFixedTimestampXInRoot(
            visualLine = visualLine,
            timestampWidthPx = timestampWidth,
            containerBoundsInRoot = containerBoundsInRoot,
            horizontalInsetPx = with(density) { 20.dp.toPx() },
            gapPx = with(density) { 12.dp.toPx() },
            preferLeft = line?.isDuet == true,
        )
    }
    val currentTimestamp = timestampX?.let { xInRootPx ->
        targetVisualLine?.let { visualLine ->
            AmllTimestampRenderState(
                text = timestampText,
                xInRootPx = xInRootPx,
                centerYInRootPx = geometry.groupBoundsInRoot.center.y,
            )
        }
    }
    var retainedTimestamp by remember { mutableStateOf<AmllTimestampRenderState?>(null) }
    SideEffect {
        if (currentTimestamp != null && retainedTimestamp != currentTimestamp) {
            retainedTimestamp = currentTimestamp
        }
    }
    val renderedTimestamp = currentTimestamp ?: retainedTimestamp
    val previewAlpha by animateFloatAsState(
        targetValue = if (visible && geometry != null) 1f else 0f,
        animationSpec = tween(if (visible) 140 else 180),
        label = "amllBrowsePreview",
    )

    Box(
        modifier = modifier.onGloballyPositioned { coordinates ->
            containerBoundsInRoot = coordinates.boundsInRoot()
        },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val groupBounds = geometry?.groupBoundsInRoot ?: return@Canvas
            if (previewAlpha <= 0f) return@Canvas
            val horizontalPadding = 7.dp.toPx()
            val verticalPadding = 5.dp.toPx()
            val left = groupBounds.left - containerBoundsInRoot.left - horizontalPadding
            val top = groupBounds.top - containerBoundsInRoot.top - verticalPadding
            val frameSize = Size(
                width = groupBounds.width + horizontalPadding * 2f,
                height = groupBounds.height + verticalPadding * 2f,
            )
            val radius = 10.dp.toPx()
            drawRoundRect(
                color = Color.White.copy(alpha = 0.045f * previewAlpha),
                topLeft = Offset(left, top),
                size = frameSize,
                cornerRadius = CornerRadius(radius),
            )
            drawRoundRect(
                color = Color.White.copy(alpha = 0.13f * previewAlpha),
                topLeft = Offset(left, top),
                size = frameSize,
                cornerRadius = CornerRadius(radius),
                style = Stroke(width = 1.dp.toPx()),
            )
        }

        renderedTimestamp?.let { timestamp ->
            AnimatedVisibility(
                visible = visible && currentTimestamp != null,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .graphicsLayer {
                        translationX = timestamp.xInRootPx - containerBoundsInRoot.left
                        translationY =
                            timestamp.centerYInRootPx -
                            containerBoundsInRoot.top -
                            size.height / 2f
                    },
                enter = fadeIn(tween(140)),
                exit = fadeOut(tween(180)),
            ) {
                Text(
                    text = timestamp.text,
                    color = Color.White.copy(alpha = 0.38f),
                    fontSize = timestampFontSize.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
    }
}
