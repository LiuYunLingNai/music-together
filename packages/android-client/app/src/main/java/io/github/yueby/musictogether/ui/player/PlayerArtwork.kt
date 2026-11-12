package io.github.yueby.musictogether.ui.player

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Disc3
import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.ui.TrackPlatformBadge
import io.github.yueby.musictogether.ui.rememberCoverImageRequest
import top.yukonga.miuix.kmp.basic.Icon

private val CoverFadeEasing = CubicBezierEasing(0.37f, 0f, 0.63f, 1f)

/**
 * Web `CoverArt`: the previous cover stays underneath while the new one loads, then the new one
 * fades in over 500ms, so a song change never dips to the placeholder.
 */
@Composable
internal fun PlayerArtwork(
    track: Track?,
    cornerRadius: Dp,
    placeholderIconSize: Dp,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
    decodeSize: Int? = null,
    platformBadge: Boolean = true,
) {
    val src = track?.cover?.takeIf(String::isNotBlank)
    var base by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    val incoming = src?.takeIf { it != base && it != failed }
    val visibleBase = base.takeIf { src != null && failed != src }
    val fade = remember(incoming) { Animatable(0f) }
    val handoff = LocalPlayerDisplaySettings.current.songHandoff
    LaunchedEffect(incoming, loaded) {
        if (incoming != null && loaded == incoming) {
            if (handoff) fade.animateTo(1f, tween(500, easing = CoverFadeEasing)) else fade.snapTo(1f)
            base = incoming
        }
    }
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius))
                .background(Color.White.copy(alpha = 0.10f)),
            contentAlignment = Alignment.Center,
        ) {
            if (visibleBase == null && incoming == null) {
                Icon(
                    Lucide.Disc3,
                    contentDescription = contentDescription,
                    modifier = Modifier.size(placeholderIconSize),
                    tint = Color.White.copy(alpha = 0.62f),
                )
            }
            for (url in listOfNotNull(visibleBase, incoming).distinct()) {
                key(url) {
                    AsyncImage(
                        model = rememberCoverImageRequest(url, decodeSize),
                        contentDescription = contentDescription.takeIf { url == src },
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer { alpha = if (url == incoming) fade.value else 1f },
                        contentScale = ContentScale.Crop,
                        onSuccess = { loaded = url },
                        onError = { failed = url },
                    )
                }
            }
        }
        if (platformBadge) {
            val compact = placeholderIconSize <= 24.dp
            TrackPlatformBadge(
                source = track?.source,
                compact = compact,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = if (compact) 3.dp else 6.dp, y = if (compact) 4.dp else 8.dp),
            )
        }
    }
}
