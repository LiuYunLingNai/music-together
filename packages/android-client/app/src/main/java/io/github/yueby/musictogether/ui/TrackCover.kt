package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.model.Track

@Composable
internal fun TrackCover(
    track: Track,
    size: Dp,
    cornerRadius: Dp,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(size)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius))
                .background(Color.Black.copy(alpha = 0.08f)),
        ) {
            AsyncImage(
                model = rememberCoverImageRequest(track.cover),
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
        TrackPlatformBadge(
            source = track.source,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = 3.dp, y = 4.dp),
        )
    }
}

@Composable
internal fun TrackPlatformBadge(
    source: String?,
    compact: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val badge = platformBadge(source) ?: return
    Text(
        text = badge.label,
        modifier = modifier
            .clip(RoundedCornerShape(3.dp))
            .background(badge.color)
            .padding(horizontal = if (compact) 2.dp else 4.dp),
        color = Color.White,
        fontSize = if (compact) 7.sp else 11.sp,
        lineHeight = if (compact) 8.sp else 12.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
    )
}

private data class PlatformBadge(val label: String, val color: Color)

private fun platformBadge(source: String?): PlatformBadge? = when (source) {
    "netease" -> PlatformBadge("网易", Color(0xFFEF4444))
    "tencent" -> PlatformBadge("QQ", Color(0xFF22C55E))
    "kugou" -> PlatformBadge("酷狗", Color(0xFF3B82F6))
    "kugou_concept" -> PlatformBadge("概念", Color(0xFF0EA5E9))
    "bilibili" -> PlatformBadge("B站", Color(0xFFEC4899))
    else -> null
}
