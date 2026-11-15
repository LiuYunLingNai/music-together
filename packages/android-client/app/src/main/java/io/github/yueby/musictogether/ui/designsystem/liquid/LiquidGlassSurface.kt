package io.github.yueby.musictogether.ui.designsystem.liquid

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.blur
import top.yukonga.miuix.kmp.blur.drawBackdrop
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** The navigation capsule's glass recipe, so every dock component reads as one material. */
@Composable
internal fun Modifier.liquidGlassSurface(
    backdrop: LayerBackdrop?,
    shape: Shape,
    pressProgress: () -> Float = { 0f },
): Modifier {
    val surfaceContainer = MiuixTheme.colorScheme.surfaceContainer
    val outline = MiuixTheme.colorScheme.onSurface.copy(alpha = 0.12f)
    val shadowed = dropShadow(shape = shape, shadow = Shadow(radius = 10.dp, color = Color.Black, alpha = 0.2f))
    return if (backdrop == null) {
        shadowed
            .graphicsLayer {
                val s = 1f + 0.02f * pressProgress()
                scaleX = s
                scaleY = s
            }
            .background(surfaceContainer, shape)
            .border(0.75.dp, outline, shape)
    } else {
        val tint = surfaceContainer.copy(alpha = 0.4f)
        val highlight = rememberGravityRotatedHighlight(iosIndicatorSpecular, extraDegrees = -45f)
        shadowed.drawBackdrop(
            backdrop = backdrop,
            shape = { shape },
            effects = {
                vibrancy()
                blur(4.dp.toPx(), 4.dp.toPx())
                lens(
                    refractionHeight = 24.dp.toPx(),
                    refractionAmount = 24.dp.toPx(),
                )
            },
            highlight = { highlight.copy(alpha = 0.75f) },
            layerBlock = {
                val s = lerp(1f, 1f + 10.dp.toPx() / size.width.coerceAtLeast(1f), pressProgress())
                scaleX = s
                scaleY = s
            },
            onDrawSurface = { drawRect(tint) },
        )
    }
}
