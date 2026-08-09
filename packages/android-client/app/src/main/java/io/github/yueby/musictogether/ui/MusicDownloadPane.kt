package io.github.yueby.musictogether.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.DownloadQualityOption
import io.github.yueby.musictogether.model.audioQualityLabel
import io.github.yueby.musictogether.network.resolveMusicDownloadDirectory
import java.util.Locale

@Composable
internal fun MusicDownloadPane(state: AppState, viewModel: MusicTogetherViewModel) {
    val track = state.room?.currentTrack
    val download = state.musicDownload
    val context = LocalContext.current
    var pendingQuality by remember(track?.id) { mutableStateOf<String?>(null) }
    var directoryText by remember(state.musicDownloadDirectory) { mutableStateOf(state.musicDownloadDirectory) }
    val resolvedDirectory = remember(directoryText) { resolveMusicDownloadDirectory(directoryText) }
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val quality = pendingQuality
        pendingQuality = null
        if (granted && quality != null) viewModel.downloadCurrentTrack(quality)
        else if (!granted) viewModel.reportDownloadStoragePermissionDenied()
    }

    fun startDownload(quality: String) {
        val needsLegacyPermission = Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
            PackageManager.PERMISSION_GRANTED
        if (needsLegacyPermission) {
            pendingQuality = quality
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            viewModel.downloadCurrentTrack(quality)
        }
    }

    LaunchedEffect(track?.id) {
        if (track != null) viewModel.loadMusicDownloadOptions()
    }
    DisposableEffect(Unit) {
        onDispose(viewModel::dismissMusicDownload)
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Text(
            "下载当前歌曲",
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(
            track?.let { "${it.title} · ${it.artist.joinToString(" / ")}" } ?: "暂无正在播放的歌曲",
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = directoryText,
                onValueChange = { directoryText = it.take(240) },
                modifier = Modifier.weight(1f),
                label = { Text("默认下载目录") },
                supportingText = if (resolvedDirectory == null) {
                    { Text("目录必须位于 /storage/emulated/0/Download") }
                } else {
                    null
                },
                isError = resolvedDirectory == null,
                singleLine = true,
            )
            Button(
                onClick = { viewModel.updateMusicDownloadDirectory(directoryText) },
                enabled = resolvedDirectory != null &&
                    resolvedDirectory.absolutePath != state.musicDownloadDirectory &&
                    download.downloadingQuality == null,
            ) {
                Icon(Icons.Default.Folder, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("保存")
            }
        }
        HorizontalDivider()

        when {
            track == null -> DownloadStatus("暂无正在播放的歌曲")
            download.trackId != track.id || download.optionsLoading -> DownloadStatus("正在获取可用音质", loading = true)
            download.optionsError != null -> DownloadStatus(
                text = download.optionsError,
                action = viewModel::loadMusicDownloadOptions,
            )
            download.options.isEmpty() -> DownloadStatus(
                text = "当前歌曲暂无可下载音质",
                action = viewModel::loadMusicDownloadOptions,
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                download.downloadError?.let { error ->
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.ErrorOutline,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                        }
                    }
                }
                items(download.options, key = { it.quality }) { option ->
                    DownloadOptionRow(
                        option = option,
                        downloading = download.downloadingQuality == option.quality,
                        enabled = download.downloadingQuality == null,
                        onDownload = { startDownload(option.quality) },
                        onCancel = viewModel::cancelMusicDownload,
                    )
                    HorizontalDivider()
                }
                item {
                    TextButton(
                        onClick = viewModel::loadMusicDownloadOptions,
                        enabled = download.downloadingQuality == null,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    ) {
                        Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("刷新音质")
                    }
                }
            }
        }
    }
}

@Composable
private fun DownloadOptionRow(
    option: DownloadQualityOption,
    downloading: Boolean,
    enabled: Boolean,
    onDownload: () -> Unit,
    onCancel: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(audioQualityLabel(option.quality)) },
        supportingContent = {
            Text(
                listOfNotNull(
                    option.format,
                    option.actualBitrate?.let { "$it kbps" },
                    option.fileSize?.let(::formatDownloadSize),
                ).joinToString(" · ").ifBlank { "可下载" },
            )
        },
        trailingContent = {
            if (downloading) {
                OutlinedButton(onClick = onCancel) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("取消")
                }
            } else {
                Button(onClick = onDownload, enabled = enabled) {
                    Icon(Icons.Default.Download, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("保存")
                }
            }
        },
    )
}

@Composable
private fun DownloadStatus(text: String, loading: Boolean = false, action: (() -> Unit)? = null) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (loading) CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
            else Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            action?.let { TextButton(onClick = it) { Text("重试") } }
        }
    }
}

private fun formatDownloadSize(bytes: Long): String = when {
    bytes >= 1024L * 1024L * 1024L ->
        String.format(Locale.ROOT, "%.1f GB", bytes.toDouble() / (1024L * 1024L * 1024L))
    bytes >= 1024L * 1024L ->
        String.format(Locale.ROOT, "%.1f MB", bytes.toDouble() / (1024L * 1024L))
    bytes >= 1024L -> String.format(Locale.ROOT, "%.1f KB", bytes.toDouble() / 1024L)
    else -> "$bytes B"
}
