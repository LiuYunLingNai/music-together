package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import top.yukonga.miuix.kmp.window.WindowBottomSheet

val LocalAppWindowSheet = staticCompositionLocalOf { false }

@Composable
fun AppModalBottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    startAction: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    WindowBottomSheet(
        show = true,
        modifier = modifier,
        title = title,
        startAction = startAction,
        backgroundColor = LocalAppPageBackground.current,
        onDismissRequest = onDismissRequest,
    ) {
        CompositionLocalProvider(LocalAppWindowSheet provides true) {
            Column(content = content)
        }
    }
}
