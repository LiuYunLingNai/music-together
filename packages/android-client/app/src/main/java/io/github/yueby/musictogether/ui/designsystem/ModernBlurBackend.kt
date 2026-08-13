package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import top.yukonga.miuix.kmp.blur.BlendColorEntry
import top.yukonga.miuix.kmp.blur.BlurColors
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.rememberLayerBackdrop
import top.yukonga.miuix.kmp.blur.textureBlur
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun rememberModernBlurBackdrop(): LayerBackdrop {
    val surface = MiuixTheme.colorScheme.surface
    return rememberLayerBackdrop {
        drawRect(surface)
        drawContent()
    }
}

@Composable
internal fun Modifier.modernGlassSurface(
    backdrop: LayerBackdrop,
    shape: Shape,
): Modifier = textureBlur(
    backdrop = backdrop,
    shape = shape,
    blurRadius = 25f,
    colors = BlurColors(
        blendColors = listOf(
            BlendColorEntry(MiuixTheme.colorScheme.surface.copy(alpha = 0.72f)),
        ),
    ),
)
