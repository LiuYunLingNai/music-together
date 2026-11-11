package io.github.yueby.musictogether.ui.player

import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.TrackLikeState
import io.github.yueby.musictogether.model.Track
import io.github.yueby.musictogether.model.isLosslessAudioQuality
import io.github.yueby.musictogether.model.shortAudioQualityLabel
import io.github.yueby.musictogether.player.AudioSpectrum
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

internal data class PortraitTrackText(
    val trackId: String?,
    val title: String,
    val subtitle: String,
    val isError: Boolean = false,
)

private val HandoffEasing = CubicBezierEasing(0.37f, 0f, 0.63f, 1f)

/** Web `SongTextCrossfade`: old text drifts up and fades, new text rises 6dp into place over 500ms. */
@Composable
internal fun <T> SongHandoff(target: T, modifier: Modifier = Modifier, content: @Composable (T) -> Unit) {
    val density = LocalDensity.current
    val rise = with(density) { 6.dp.roundToPx() }
    val drift = with(density) { 4.dp.roundToPx() }
    AnimatedContent(
        targetState = target,
        modifier = modifier,
        transitionSpec = {
            (fadeIn(tween(500, easing = HandoffEasing)) +
                slideInVertically(tween(500, easing = HandoffEasing)) { rise }) togetherWith
                (fadeOut(tween(500, easing = HandoffEasing)) +
                    slideOutVertically(tween(500, easing = HandoffEasing)) { -drift }) using
                SizeTransform(clip = false)
        },
        label = "song-handoff",
    ) { content(it) }
}

@Composable
internal fun QualityBadge(track: Track?, modifier: Modifier = Modifier) {
    val label = shortAudioQualityLabel(track?.audioQuality, track?.audioBitrate) ?: return
    val lossless = isLosslessAudioQuality(track?.audioQuality, track?.audioBitrate)
    Text(
        text = if (track?.qualityDowngraded == true) "$label ↓" else label,
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(if (lossless) Color(0x26F59E0B) else Color.White.copy(alpha = 0.10f))
            .padding(horizontal = 4.dp),
        color = if (lossless) Color(0xFFFCD34D) else Color.White.copy(alpha = 0.62f),
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
internal fun LikeButton(like: TrackLikeState?, onToggle: () -> Unit, size: Dp, modifier: Modifier = Modifier) {
    if (like == null) return
    val scale by animateFloatAsState(if (like.liked) 1f else 0.92f, tween(180), label = "like-scale")
    IconButton(onClick = onToggle, enabled = !like.busy, modifier = modifier) {
        Icon(
            if (like.liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
            contentDescription = if (like.liked) "取消喜欢" else "喜欢到网易云",
            modifier = Modifier.size(size * scale),
            tint = if (like.liked) Color(0xFFFF6B81) else Color.White.copy(alpha = 0.78f),
        )
    }
}

private class SpectrumState {
    var buf = FloatArray(0)
    var scratch = FloatArray(0)
    var maxValue = 100f

    val settled: Boolean get() = buf.all { it < 0.5f }

    /** Web `AudioFFTVisualizer`: per-frame EMA toward the tilted target, normalised to 60fps. */
    fun step(target: FloatArray, dtNanos: Long) {
        val keep = (1.0 / 3.0).pow(dtNanos / 16_666_667.0).toFloat()
        if (target.isEmpty()) {
            for (i in buf.indices) buf[i] *= keep
            return
        }
        if (buf.size != target.size) {
            buf = target.copyOf()
            return
        }
        for (i in buf.indices) {
            val tilt = min((i + 5f) / buf.size * 4f, 1f)
            buf[i] = buf[i] * keep + target[i] * tilt * (1f - keep)
        }
    }

    fun resample(count: Int): FloatArray {
        if (scratch.size != count) scratch = FloatArray(count)
        val n = buf.size
        if (n == 0) {
            scratch.fill(0f)
            return scratch
        }
        val ratio = (n - 1f) / max(1, count - 1)
        for (i in 0 until count) {
            val x = i * ratio
            val x0 = floor(x).toInt()
            val x1 = min(n - 1, x0 + 1)
            val t = x - x0
            scratch[i] = buf[x0] * (1f - t) + buf[x1] * t
        }
        return scratch
    }
}

@Composable
internal fun ControlsSpectrum(visible: Boolean, playing: Boolean, height: Dp, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn() + expandVertically(),
        exit = fadeOut() + shrinkVertically(),
        modifier = modifier,
    ) {
        SpectrumCanvas(playing, height)
    }
}

@Composable
private fun SpectrumCanvas(playing: Boolean, height: Dp) {
    DisposableEffect(Unit) {
        AudioSpectrum.enabled = true
        onDispose { AudioSpectrum.enabled = false }
    }
    val state = remember { SpectrumState() }
    var frame by remember { mutableLongStateOf(0L) }
    val playingNow by rememberUpdatedState(playing)
    LaunchedEffect(playing) {
        var last = 0L
        while (true) {
            val settled = androidx.compose.runtime.withFrameNanos { now ->
                val dt = if (last == 0L) 16_666_667L else (now - last).coerceIn(1_000_000L, 100_000_000L)
                last = now
                state.step(if (playingNow) AudioSpectrum.latest else FloatArray(0), dt)
                frame = now
                !playingNow && state.settled
            }
            if (settled) break
        }
    }
    Canvas(Modifier.fillMaxWidth().height(height)) {
        frame
        val spacing = 8.dp.toPx()
        val count = max(8, floor(size.width / spacing).toInt())
        val display = state.resample(count)
        state.maxValue = max(display.max() * 0.1f + state.maxValue * 0.9f, 100f)
        val barWidth = size.width / count
        val beginY = size.height - barWidth
        val usable = size.height - barWidth * 2
        val stroke = 4.dp.toPx()
        for (i in 0 until count) {
            val x = barWidth * (i + 0.5f)
            val norm = (display[i] / state.maxValue).coerceIn(0f, 1f)
            drawLine(
                color = Color.White.copy(alpha = 0.92f),
                start = Offset(x, beginY),
                end = Offset(x, beginY - norm * norm * usable),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}

/** Web `LYRIC_MASK_STYLE`: lyrics fade out over the top and bottom 5%. */
internal fun Modifier.lyricFadeMask(edge: Float = 0.05f): Modifier = this
    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        drawRect(
            brush = Brush.verticalGradient(
                0f to Color.Transparent,
                edge to Color.Black,
                1f - edge to Color.Black,
                1f to Color.Transparent,
            ),
            blendMode = BlendMode.DstIn,
        )
    }
