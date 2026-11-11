package io.github.yueby.musictogether.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.PasswordVisualTransformation
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import io.github.yueby.musictogether.ui.designsystem.AppTextField

@Composable
internal fun PasswordDialog(roomName: String, onDismiss: () -> Unit, onJoin: (String) -> Unit) {
    var password by remember { mutableStateOf("") }
    AppDialog(
        onDismissRequest = onDismiss,
        title = "加入 $roomName",
        confirmText = "加入",
        onConfirm = { onJoin(password) },
        confirmEnabled = password.isNotBlank(),
    ) {
        AppTextField(
            value = password,
            onValueChange = { password = it.take(32) },
            label = "房间密码",
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
    }
}
