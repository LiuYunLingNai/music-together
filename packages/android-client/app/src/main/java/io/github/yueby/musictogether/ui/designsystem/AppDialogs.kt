package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.UiStyle
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.window.WindowDialog

@Composable
fun AppDialog(
    title: String,
    onDismissRequest: () -> Unit,
    confirmText: String,
    onConfirm: () -> Unit,
    confirmEnabled: Boolean = true,
    dismissText: String? = "取消",
    content: @Composable () -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> AlertDialog(
            onDismissRequest = onDismissRequest,
            title = { Text(title) },
            text = content,
            confirmButton = {
                TextButton(onClick = onConfirm, enabled = confirmEnabled) { Text(confirmText) }
            },
            dismissButton = dismissText?.let { label ->
                { TextButton(onClick = onDismissRequest) { Text(label) } }
            },
        )

        UiStyle.Miuix -> WindowDialog(
            show = true,
            title = title,
            backgroundColor = LocalAppPageBackground.current,
            onDismissRequest = onDismissRequest,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                content()
                Row(Modifier.fillMaxWidth()) {
                    dismissText?.let { label ->
                        MiuixTextButton(
                            text = label,
                            onClick = onDismissRequest,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(12.dp))
                    }
                    MiuixTextButton(
                        text = confirmText,
                        onClick = onConfirm,
                        enabled = confirmEnabled,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.textButtonColorsPrimary(),
                    )
                }
            }
        }
    }
}

@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> androidx.compose.material3.OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier,
            enabled = enabled,
            label = { Text(label) },
            singleLine = true,
            visualTransformation = visualTransformation,
        )

        UiStyle.Miuix -> MiuixTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier.padding(vertical = 2.dp),
            enabled = enabled,
            label = label,
            visualTransformation = visualTransformation,
        )
    }
}

@Composable
fun AppButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = true,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> if (primary) {
            Button(onClick = onClick, modifier = modifier, enabled = enabled) { Text(text) }
        } else {
            OutlinedButton(onClick = onClick, modifier = modifier, enabled = enabled) { Text(text) }
        }

        UiStyle.Miuix -> MiuixTextButton(
            text = text,
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            colors = if (primary) ButtonDefaults.textButtonColorsPrimary() else ButtonDefaults.textButtonColors(),
        )
    }
}
