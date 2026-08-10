package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.ui.rememberCoverImageRequest
import io.github.yueby.musictogether.ui.TrackPlatformBadge

private data class ArtworkTarget(
    val trackId: String?,
    val coverUrl: String?,
    val source: String?,
)

@Composable
internal fun PlayerArtwork(
    track: Track?,
    cornerRadius: Dp,
    placeholderIconSize: Dp,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    val target = ArtworkTarget(
        trackId = track?.id,
        coverUrl = track?.cover?.takeIf(String::isNotBlank),
        source = track?.source,
    )
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Crossfade(
            targetState = target,
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius))
                .background(Color.White.copy(alpha = 0.10f)),
            animationSpec = tween(360),
            label = "player-artwork-crossfade",
        ) { artwork ->
            var failed by remember(artwork) { mutableStateOf(false) }
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                if (artwork.coverUrl != null && !failed) {
                    AsyncImage(
                        model = rememberCoverImageRequest(artwork.coverUrl),
                        contentDescription = contentDescription,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                        onError = { failed = true },
                    )
                } else {
                    Icon(
                        Icons.Default.LibraryMusic,
                        contentDescription = contentDescription,
                        modifier = Modifier.size(placeholderIconSize),
                        tint = Color.White.copy(alpha = 0.62f),
                    )
                }
            }
        }
        TrackPlatformBadge(
            source = target.source,
            compact = placeholderIconSize <= 24.dp,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = if (placeholderIconSize <= 24.dp) 3.dp else 6.dp, y = if (placeholderIconSize <= 24.dp) 4.dp else 8.dp),
        )
    }
}
