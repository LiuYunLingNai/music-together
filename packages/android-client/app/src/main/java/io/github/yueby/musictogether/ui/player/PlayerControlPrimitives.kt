package io.github.yueby.musictogether.ui.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu as MaterialDropdownMenu
import androidx.compose.material3.DropdownMenuItem as MaterialDropdownMenuItem
import androidx.compose.material3.IconButton as MaterialIconButton
import androidx.compose.material3.Slider as MaterialSlider
import androidx.compose.material3.Surface as MaterialSurface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.ListPopupColumn
import top.yukonga.miuix.kmp.basic.Slider as MiuixSlider
import top.yukonga.miuix.kmp.basic.Surface as MiuixSurface
import top.yukonga.miuix.kmp.window.WindowListPopup

/** Keeps player controls visually native to the selected design system. */
@Composable
internal fun IconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialIconButton(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            interactionSource = interactionSource,
            content = content,
        )

        UiStyle.Miuix -> MiuixIconButton(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            content = content,
        )
    }
}

@Composable
internal fun PlayerSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialSlider(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier,
            valueRange = valueRange,
            steps = steps,
            onValueChangeFinished = onValueChangeFinished,
        )

        UiStyle.Miuix -> MiuixSlider(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier,
            valueRange = valueRange,
            steps = steps,
            onValueChangeFinished = onValueChangeFinished,
        )
    }
}

@Composable
internal fun Surface(
    modifier: Modifier = Modifier,
    shape: Shape,
    color: Color,
    contentColor: Color = Color.White,
    tonalElevation: Dp = 0.dp,
    shadowElevation: Dp = 0.dp,
    content: @Composable () -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialSurface(
            modifier = modifier,
            shape = shape,
            color = color,
            contentColor = contentColor,
            tonalElevation = tonalElevation,
            shadowElevation = shadowElevation,
            content = content,
        )

        UiStyle.Miuix -> MiuixSurface(
            modifier = modifier,
            shape = shape,
            color = color,
            contentColor = contentColor,
            shadowElevation = shadowElevation,
            content = content,
        )
    }
}

@Composable
internal fun DropdownMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(18.dp),
    containerColor: Color = Color(0xF21A1A1C),
    tonalElevation: Dp = 0.dp,
    shadowElevation: Dp = 14.dp,
    content: @Composable () -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialDropdownMenu(
            expanded = expanded,
            onDismissRequest = onDismissRequest,
            modifier = modifier,
            shape = shape,
            containerColor = containerColor,
            tonalElevation = tonalElevation,
            shadowElevation = shadowElevation,
        ) {
            content()
        }

        UiStyle.Miuix -> WindowListPopup(
            show = expanded,
            popupModifier = modifier,
            enableWindowDim = false,
            onDismissRequest = onDismissRequest,
        ) {
            ListPopupColumn(content = content)
        }
    }
}

@Composable
internal fun DropdownMenuItem(
    text: @Composable () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 2.dp),
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialDropdownMenuItem(
            text = text,
            onClick = onClick,
            modifier = modifier,
            leadingIcon = leadingIcon,
            enabled = enabled,
            contentPadding = contentPadding,
        )

        UiStyle.Miuix -> Row(
            modifier = modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 52.dp)
                .clickable(enabled = enabled, onClick = onClick)
                .graphicsLayer { alpha = if (enabled) 1f else 0.38f }
                .padding(contentPadding),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            leadingIcon?.let { icon ->
                Box(Modifier.padding(end = 12.dp), contentAlignment = Alignment.Center) { icon() }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) { text() }
        }
    }
}
