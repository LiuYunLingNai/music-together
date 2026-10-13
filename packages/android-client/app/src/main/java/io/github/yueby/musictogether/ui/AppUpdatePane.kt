package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.UpdateDownloadSource
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.SmallTitle as MiuixSmallTitle
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun AppUpdatePane(state: AppState, viewModel: MusicTogetherViewModel) {
    LaunchedEffect(Unit) {
        viewModel.checkForAppUpdate()
    }
    MiuixAppUpdatePane(state, viewModel)
}

@Composable
private fun MiuixAppUpdatePane(state: AppState, viewModel: MusicTogetherViewModel) {
    val update = state.updateInfo
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            MiuixCard(Modifier.fillMaxWidth()) {
                ArrowPreference(
                    title = "当前版本 v${BuildConfig.VERSION_NAME}",
                    summary = when {
                        state.updateChecking -> "正在检查更新…"
                        update != null -> "发现新版本 v${update.versionName}"
                        state.updateError != null -> "未能获取更新信息"
                        else -> "已是最新版本"
                    },
                    startAction = { MiuixIcon(Icons.Default.SystemUpdate, null, tint = MiuixTheme.colorScheme.primary) },
                    onClick = viewModel::checkForAppUpdate,
                )
                if (update != null) {
                    OverlayDropdownPreference(
                        title = "下载源",
                        items = listOf("GitHub", "ghfast.top"),
                        selectedIndex = UpdateDownloadSource.entries.indexOf(state.updateSource).coerceAtLeast(0),
                        enabled = !state.updateDownloading && !state.updateReadyToInstall,
                        onSelectedIndexChange = { index ->
                            UpdateDownloadSource.entries.getOrNull(index)?.let(viewModel::selectUpdateDownloadSource)
                        },
                    )
                }
            }
        }
        update?.releaseNotes?.takeIf { it.isNotBlank() }?.let { notes ->
            item {
                MiuixSmallTitle(text = "更新内容")
                MiuixCard(Modifier.fillMaxWidth()) {
                    MiuixText(
                        text = notes,
                        modifier = Modifier.padding(16.dp),
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                        style = MiuixTheme.textStyles.body2,
                        maxLines = 10,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (update != null) {
            item {
                MiuixTextButton(
                    text = when {
                        state.updateReadyToInstall -> "安装更新"
                        state.updateDownloading -> state.updateDownloadProgress?.let { "正在下载 $it%" } ?: "正在下载…"
                        else -> "下载更新"
                    },
                    onClick = if (state.updateReadyToInstall) viewModel::installDownloadedUpdate else viewModel::downloadAppUpdate,
                    enabled = !state.updateDownloading || state.updateReadyToInstall,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColorsPrimary(),
                )
            }
        }
        state.updateError?.let { message ->
            item { MiuixText(message, color = MiuixTheme.colorScheme.error, style = MiuixTheme.textStyles.footnote1) }
        }
    }
}
