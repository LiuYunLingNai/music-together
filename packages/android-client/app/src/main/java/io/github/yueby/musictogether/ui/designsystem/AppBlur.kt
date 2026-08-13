package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.isRuntimeShaderSupported

@Composable
fun rememberAppBlurBackdrop(enabled: Boolean): LayerBackdrop? {
    if (!enabled || !isRuntimeShaderSupported()) return null
    return rememberModernBlurBackdrop()
}

@Composable
fun Modifier.appGlassSurface(
    backdrop: LayerBackdrop?,
    shape: Shape,
): Modifier = if (backdrop == null || !isRuntimeShaderSupported()) {
    this
} else {
    modernGlassSurface(backdrop, shape)
}
