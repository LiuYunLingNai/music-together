package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppTextField
import kotlinx.coroutines.delay
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.RadioButton
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun CreateRoomForm(state: AppState, viewModel: MusicTogetherViewModel) {
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var serverUrl by rememberSaveable { mutableStateOf(state.selectedServerUrl) }
    var submitted by remember { mutableStateOf(false) }
    val validServer = state.servers.any { it.url == serverUrl }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
    ) {
        if (state.servers.size > 1) {
            SmallTitle(text = "服务器")
            Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                state.servers.forEach { server ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { serverUrl = server.url }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        RadioButton(selected = serverUrl == server.url, onClick = { serverUrl = server.url })
                        Column(Modifier.weight(1f)) {
                            Text(
                                server.url.removePrefix("https://").removePrefix("http://"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when (server.status) {
                                    ConnectionStatus.Connected -> "已连接"
                                    ConnectionStatus.Connecting -> "连接中"
                                    ConnectionStatus.Disconnected -> "未连接，创建时自动连接"
                                },
                                style = MiuixTheme.textStyles.footnote1,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                }
            }
        }
        SmallTitle(text = "房间信息")
        Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AppTextField(
                value = name,
                onValueChange = { name = it.take(30) },
                label = "房间名（可选）",
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            AppTextField(
                value = password,
                onValueChange = { password = it.take(32) },
                label = "密码（可选，留空即公开加入）",
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "创建后你将成为房主，可在「房间与同步」里调整音质、可见性和权限。",
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
            AppButton(
                text = if (submitted) "正在创建…" else "创建房间",
                onClick = {
                    submitted = true
                    viewModel.createRoomOnServer(serverUrl, name, password)
                },
                enabled = validServer && !submitted,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
    }
    LaunchedEffect(submitted) {
        if (submitted) {
            delay(5_000)
            submitted = false
        }
    }
}

@Composable
internal fun JoinRoomForm(state: AppState, viewModel: MusicTogetherViewModel) {
    var input by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val submit = {
        if (input.isNotBlank()) viewModel.joinRoomInput(input.trim(), password)
    }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AppTextField(
            value = input,
            onValueChange = { input = it.take(512) },
            label = "房间号或邀请链接",
            singleLine = true,
            modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )
        AppTextField(
            value = password,
            onValueChange = { password = it.take(32) },
            label = "房间密码（没有可留空）",
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }),
        )
        Text(
            "支持粘贴网页邀请链接、应用链接或直接输入房间号。",
            modifier = Modifier.padding(horizontal = 4.dp),
            style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )
        AppButton(
            text = "加入房间",
            onClick = submit,
            enabled = input.isNotBlank() && state.servers.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
    }
}
