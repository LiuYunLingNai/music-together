package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.InstallMobile
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.UpdateDownloadSource

@Composable
fun AppUpdatePane(state: AppState, viewModel: MusicTogetherViewModel) {
    LaunchedEffect(Unit) {
        viewModel.checkForAppUpdate()
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.SystemUpdate, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("应用更新", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(
                        "当前版本 v${BuildConfig.VERSION_NAME}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(
                    onClick = { viewModel.checkForAppUpdate() },
                    enabled = !state.updateChecking && !state.updateDownloading,
                ) {
                    if (state.updateChecking) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Refresh, "检查更新")
                    }
                }
            }
        }
        item { HorizontalDivider() }

        when {
            state.updateChecking && state.updateInfo == null -> item {
                Text("正在检查更新...", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.updateError != null && state.updateInfo == null -> item {
                Text("未能获取更新信息", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.updateInfo == null -> item {
                Text("已是最新版本", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> {
                val update = requireNotNull(state.updateInfo)
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("发现新版本 v${update.versionName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (update.releaseNotes.isNotBlank()) {
                            Text(
                                update.releaseNotes,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 8,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                item {
                    Text("下载源", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                        UpdateDownloadSource.entries.forEachIndexed { index, source ->
                            SegmentedButton(
                                selected = state.updateSource == source,
                                onClick = { viewModel.selectUpdateDownloadSource(source) },
                                shape = SegmentedButtonDefaults.itemShape(index, UpdateDownloadSource.entries.size),
                                enabled = !state.updateDownloading && !state.updateReadyToInstall,
                                label = { Text(if (source == UpdateDownloadSource.GitHub) "GitHub" else "ghfast.top") },
                            )
                        }
                    }
                }
                item {
                    if (state.updateReadyToInstall) {
                        Button(
                            onClick = viewModel::installDownloadedUpdate,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.InstallMobile, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("安装更新")
                        }
                    } else {
                        Button(
                            onClick = viewModel::downloadAppUpdate,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !state.updateDownloading,
                        ) {
                            Icon(Icons.Default.Download, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(if (state.updateDownloading) "正在下载" else "下载更新")
                        }
                    }
                    if (state.updateDownloading) {
                        val progress = state.updateDownloadProgress
                        LinearProgressIndicator(
                            progress = (progress ?: 0) / 100f,
                            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                        )
                        Text(
                            progress?.let { "已下载 $it%" } ?: "正在下载...",
                            modifier = Modifier.padding(top = 6.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        state.updateError?.let { message ->
            item {
                Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
