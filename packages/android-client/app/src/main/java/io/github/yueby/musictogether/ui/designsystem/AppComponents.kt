package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Surface
import top.yukonga.miuix.kmp.theme.LocalContentColor
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun AppListItem(
    headlineContent: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    supportingContent: (@Composable () -> Unit)? = null,
    leadingContent: (@Composable () -> Unit)? = null,
    trailingContent: (@Composable () -> Unit)? = null,
    containerColor: Color = Color.Transparent,
) {
    Row(
        modifier = modifier
            .background(containerColor)
            .heightIn(min = 56.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leadingContent?.let { Box(Modifier.padding(end = 16.dp)) { it() } }
        Column(Modifier.weight(1f)) {
            headlineContent()
            supportingContent?.let { supporting ->
                CompositionLocalProvider(
                    LocalContentColor provides MiuixTheme.colorScheme.onSurfaceVariantSummary,
                ) { supporting() }
            }
        }
        trailingContent?.let { Box(Modifier.padding(start = 16.dp)) { it() } }
    }
}

@Composable
fun AppChip(
    onClick: () -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    leadingIcon: (@Composable () -> Unit)? = null,
) {
    val colors = MiuixTheme.colorScheme
    val container = if (selected) colors.primaryContainer else colors.surfaceContainer
    val content = if (selected) colors.onPrimaryContainer else colors.onSurface
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = container,
        contentColor = content,
        border = BorderStroke(1.dp, colors.dividerLine),
    ) {
        Row(
            Modifier.heightIn(min = 32.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            leadingIcon?.let {
                it()
                Spacer(Modifier.width(6.dp))
            }
            label()
        }
    }
}

@Composable
fun AppTextAction(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentColor: Color = MiuixTheme.colorScheme.primary,
    content: @Composable RowScope.() -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        minHeight = 36.dp,
        colors = ButtonDefaults.buttonColors(
            color = Color.Transparent,
            disabledColor = Color.Transparent,
            contentColor = contentColor,
            disabledContentColor = contentColor.copy(alpha = 0.4f),
        ),
        insideMargin = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        content = content,
    )
}
