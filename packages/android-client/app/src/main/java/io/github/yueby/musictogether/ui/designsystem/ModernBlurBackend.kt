package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.runtime.Composable
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.rememberLayerBackdrop
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun rememberModernBlurBackdrop(): LayerBackdrop {
    val surface = MiuixTheme.colorScheme.surface
    return rememberLayerBackdrop {
        drawRect(surface)
        drawContent()
    }
}
