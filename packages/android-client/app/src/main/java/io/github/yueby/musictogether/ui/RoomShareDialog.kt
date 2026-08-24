package io.github.yueby.musictogether.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.RoomShareState
import io.github.yueby.musictogether.share.ShareCardMetrics
import io.github.yueby.musictogether.share.shareImageIntent
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppDialog

@Composable
internal fun RoomShareDialog(state: RoomShareState, viewModel: MusicTogetherViewModel) {
    if (!state.visible) return
    val context = LocalContext.current
    AppDialog(
        title = "分享房间",
        onDismissRequest = viewModel::dismissRoomShare,
        confirmText = "分享图片",
        confirmEnabled = state.imageUri != null,
        onConfirm = {
            val uri = state.imageUri ?: return@AppDialog
            val intent = shareImageIntent(Uri.parse(uri), state.link)
            context.startActivity(Intent.createChooser(intent, "分享房间"))
            viewModel.dismissRoomShare()
        },
        dismissText = "关闭",
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(SHARE_CARD_ASPECT_RATIO)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.Black.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    state.imageUri != null -> AsyncImage(
                        model = state.imageUri,
                        contentDescription = "房间分享图片预览",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                    )

                    state.loading -> CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)

                    else -> Text(
                        text = state.error ?: "分享图片不可用",
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            if (state.error != null && state.imageUri != null) {
                Text(
                    text = state.error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Text(
                text = state.link,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AppButton(
                text = "复制 App 房间链接",
                onClick = viewModel::copyRoomAppLink,
                modifier = Modifier.fillMaxWidth(),
                primary = false,
            )
        }
    }
}

private const val SHARE_CARD_ASPECT_RATIO =
    ShareCardMetrics.WIDTH.toFloat() / ShareCardMetrics.HEIGHT.toFloat()
