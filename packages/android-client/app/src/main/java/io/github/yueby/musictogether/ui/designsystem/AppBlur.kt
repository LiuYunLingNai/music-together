package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.runtime.Composable
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.isRuntimeShaderSupported

@Composable
fun rememberAppBlurBackdrop(enabled: Boolean): LayerBackdrop? {
    if (!enabled || !isRuntimeShaderSupported()) return null
    return rememberModernBlurBackdrop()
}
