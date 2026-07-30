package io.github.yueby.musictogether.ui.player

import android.animation.ValueAnimator
import android.app.ActivityManager
import android.content.Context
import android.os.PowerManager
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.palette.graphics.Palette
import coil3.BitmapImage
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.ui.rememberBackdropImageRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class BackdropColors(
    val primary: Color,
    val secondary: Color,
)

private val DefaultBackdropColors = BackdropColors(
    primary = Color(0xFF242126),
    secondary = Color(0xFF111214),
)

@Composable
internal fun PlayerBackdrop(
    coverUrl: String?,
    playing: Boolean,
    motionAllowed: Boolean,
    shortestSide: Dp,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activityManager = remember(context) {
        context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    }
    val powerManager = remember(context) {
        context.getSystemService(Context.POWER_SERVICE) as PowerManager
    }
    val motionEnabled =
        ValueAnimator.areAnimatorsEnabled() &&
            !activityManager.isLowRamDevice &&
            !powerManager.isPowerSaveMode
    val drift = remember { Animatable(0f) }
    val backgroundScale = animateFloatAsState(
        targetValue = if (playing && motionEnabled && motionAllowed) 1.28f else 1.22f,
        animationSpec = if (motionAllowed) tween(1_400) else snap(),
        label = "player-backdrop-scale",
    )
    val driftDistancePx = with(LocalDensity.current) {
        (shortestSide * 0.035f).toPx()
    }

    LaunchedEffect(playing, motionEnabled, motionAllowed) {
        if (!motionAllowed) {
            drift.snapTo(0f)
            return@LaunchedEffect
        }
        if (!playing || !motionEnabled) {
            drift.animateTo(0f, tween(800))
            return@LaunchedEffect
        }
        while (isActive) {
            drift.animateTo(1f, tween(10_000, easing = LinearEasing))
            drift.animateTo(-1f, tween(20_000, easing = LinearEasing))
            drift.animateTo(0f, tween(10_000, easing = LinearEasing))
        }
    }

    Crossfade(
        targetState = coverUrl?.takeIf(String::isNotBlank),
        animationSpec = tween(700),
        modifier = modifier,
        label = "player-backdrop-crossfade",
    ) { targetCover ->
        BackdropLayer(
            coverUrl = targetCover,
            drift = { drift.value },
            driftDistancePx = driftDistancePx,
            scale = { backgroundScale.value },
        )
    }
}

@Composable
private fun BackdropLayer(
    coverUrl: String?,
    drift: () -> Float,
    driftDistancePx: Float,
    scale: () -> Float,
) {
    var colors by remember(coverUrl) { mutableStateOf(DefaultBackdropColors) }
    val paletteScope = rememberCoroutineScope()
    val primary by animateColorAsState(
        targetValue = colors.primary,
        animationSpec = tween(550),
        label = "player-backdrop-primary",
    )
    val secondary by animateColorAsState(
        targetValue = colors.secondary,
        animationSpec = tween(550),
        label = "player-backdrop-secondary",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(secondary),
    ) {
        if (coverUrl != null) {
            AsyncImage(
                model = rememberBackdropImageRequest(coverUrl),
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val currentDrift = drift()
                        val currentScale = scale()
                        scaleX = currentScale + kotlin.math.abs(currentDrift) * 0.025f
                        scaleY = currentScale + kotlin.math.abs(currentDrift) * 0.025f
                        translationX = currentDrift * driftDistancePx
                        translationY = -currentDrift * driftDistancePx * 0.62f
                        rotationZ = currentDrift * 0.10f
                        alpha = 0.58f
                    }
                    .blur(30.dp),
                contentScale = ContentScale.Crop,
                onSuccess = { state ->
                    val bitmap = (state.result.image as? BitmapImage)?.bitmap
                    if (bitmap != null) {
                        // The request is decoded at 96 px, so this one-off palette
                        // calculation is cheap and never touches the full cover.
                        paletteScope.launch {
                            withContext(Dispatchers.Default) {
                                extractBackdropColors(bitmap)
                            }?.let { extracted ->
                                colors = extracted
                            }
                        }
                    }
                },
            )
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            primary.copy(alpha = 0.32f),
                            Color.Transparent,
                        ),
                        radius = 1_150f,
                    ),
                )
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.26f),
                        0.48f to Color.Black.copy(alpha = 0.10f),
                        1f to Color.Black.copy(alpha = 0.42f),
                    ),
                ),
        )
    }
}

private fun extractBackdropColors(bitmap: android.graphics.Bitmap): BackdropColors? {
    val palette = Palette.from(bitmap)
        .maximumColorCount(8)
        .generate()
    val primaryInt =
        palette.vibrantSwatch?.rgb
            ?: palette.mutedSwatch?.rgb
            ?: palette.dominantSwatch?.rgb
            ?: return null
    val secondaryInt =
        palette.darkVibrantSwatch?.rgb
            ?: palette.darkMutedSwatch?.rgb
            ?: primaryInt
    return BackdropColors(
        primary = Color(primaryInt),
        secondary = Color(secondaryInt),
    )
}
