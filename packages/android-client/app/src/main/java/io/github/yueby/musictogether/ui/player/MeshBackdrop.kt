package io.github.yueby.musictogether.ui.player

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.FloatState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.platform.LocalContext
import coil3.BitmapImage
import coil3.SingletonImageLoader
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.allowHardware
import io.github.yueby.musictogether.player.AudioSpectrum
import io.github.yueby.musictogether.ui.coverNetworkHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.min

private const val MeshShaderSource = """
uniform shader album;
uniform float2 size;
uniform float tex;
uniform float time;
uniform float volume;

float2 rot(float2 p, float a) {
    float s = sin(a);
    float c = cos(a);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

half4 main(float2 fragCoord) {
    float2 uv = fragCoord / size;
    float aspect = size.x / size.y;
    float2 p = (uv - 0.5) * float2(min(aspect, 1.0), min(1.0 / aspect, 1.0));
    p = rot(p, time * 0.045);
    float2 q = p;
    q += 0.22 * float2(sin(p.y * 2.6 + time * 0.31), cos(p.x * 2.2 - time * 0.27));
    q += 0.12 * float2(sin(q.y * 4.3 - time * 0.19 + 1.7), cos(q.x * 3.9 + time * 0.23 + 0.6));
    q = rot(q, sin(time * 0.07) * 0.6);
    q *= 0.52 - volume * 0.06;
    half4 c = album.eval(clamp(q + 0.5, 0.04, 0.96) * tex);
    float n = fract(sin(dot(fragCoord, float2(12.9898, 78.233))) * 43758.5453);
    half3 rgb = c.rgb * (1.0 + volume * 0.12) + (n - 0.5) / 128.0;
    return half4(rgb, 1.0);
}
"""

private const val MeshTextureSize = 128

/**
 * AMLL mesh-gradient style backdrop: the cover is reduced to a 32px colour field (same contrast /
 * saturation / brightness / blur chain as upstream), then flowed by a UV-warp shader that pulses
 * with the low-frequency level.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
internal fun MeshBackdrop(
    coverUrl: String?,
    animate: Boolean,
    flowSpeed: Float,
    fps: Int,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var texture by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(coverUrl) {
        if (coverUrl == null) {
            texture = null
            return@LaunchedEffect
        }
        val request = ImageRequest.Builder(context)
            .data(coverUrl)
            .httpHeaders(coverNetworkHeaders)
            .size(64)
            .allowHardware(false)
            .build()
        val source = (SingletonImageLoader.get(context).execute(request).image as? BitmapImage)?.bitmap
            ?: return@LaunchedEffect
        texture = withContext(Dispatchers.Default) { meshTexture(source) }
    }

    val time = remember { mutableFloatStateOf(0f) }
    val volume = remember { mutableFloatStateOf(0f) }
    DisposableEffect(animate) {
        if (animate) AudioSpectrum.acquire()
        onDispose { if (animate) AudioSpectrum.release() }
    }
    LaunchedEffect(animate, flowSpeed, fps) {
        if (!animate) return@LaunchedEffect
        val history = ArrayDeque<Float>()
        var last = 0L
        var pending = 0f
        val frameMs = 1_000f / fps - 2f
        while (true) {
            withFrameNanos { now ->
                pending += if (last == 0L) 16f else ((now - last) / 1_000_000f).coerceAtMost(100f)
                last = now
                if (pending < frameMs) return@withFrameNanos
                val dtMs = pending
                pending = 0f
                time.floatValue += dtMs / 1_000f * flowSpeed
                val target = lowFreqGradient(history, AudioSpectrum.lowFreqLevel)
                volume.floatValue += (target - volume.floatValue) * min(1f, 0.003f * dtMs)
            }
        }
    }

    Crossfade(targetState = texture, animationSpec = tween(900), modifier = modifier, label = "mesh-backdrop") { bitmap ->
        if (bitmap == null) {
            Box(Modifier.fillMaxSize().background(Color(0xFF111214)))
        } else {
            MeshLayer(bitmap, time, volume)
        }
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
private fun MeshLayer(bitmap: Bitmap, time: FloatState, volume: FloatState) {
    val shader = remember(bitmap) {
        RuntimeShader(MeshShaderSource).apply {
            val album = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            album.filterMode = BitmapShader.FILTER_MODE_LINEAR
            setInputShader("album", album)
            setFloatUniform("tex", bitmap.width.toFloat())
        }
    }
    Spacer(
        Modifier.fillMaxSize().drawBehind {
            shader.setFloatUniform("size", size.width, size.height)
            shader.setFloatUniform("time", time.floatValue)
            shader.setFloatUniform("volume", volume.floatValue)
            drawRect(ShaderBrush(shader))
        },
    )
}

/** AMLL `calculateGradient`: peak detection over a 10-frame window. */
private fun lowFreqGradient(history: ArrayDeque<Float>, level: Float): Float {
    if (history.size < 10 && level !in history) {
        history.addLast(level)
        return 0f
    }
    history.removeFirstOrNull()
    history.addLast(level)
    val peak = history.max().let { it * it }
    val floor = history.min()
    return if (peak - floor > 0.35f) peak else floor * 0.25f
}

private fun meshTexture(source: Bitmap): Bitmap {
    val small = 32
    val scaled = Bitmap.createScaledBitmap(source, small, small, true)
    val pixels = IntArray(small * small)
    scaled.getPixels(pixels, 0, small, 0, 0, small, small)
    val channels = Array(3) { c -> FloatArray(pixels.size) { ((pixels[it] shr (16 - 8 * c)) and 0xFF).toFloat() } }
    fun each(block: (Float) -> Float) = channels.forEach { ch ->
        for (i in ch.indices) ch[i] = block(ch[i]).coerceIn(0f, 255f)
    }
    fun contrast(amount: Float) = each { (it - 128f) * amount + 128f }
    contrast(0.4f)
    for (i in pixels.indices) {
        val gray = channels[0][i] * 0.3f + channels[1][i] * 0.59f + channels[2][i] * 0.11f
        for (ch in channels) ch[i] = (gray * -2f + ch[i] * 3f).coerceIn(0f, 255f)
    }
    contrast(1.7f)
    each { it * 0.75f }
    channels.forEach { boxBlur(it, small, small, 2, 4) }
    for (i in pixels.indices) {
        pixels[i] = (0xFF shl 24) or (channels[0][i].toInt() shl 16) or (channels[1][i].toInt() shl 8) or channels[2][i].toInt()
    }
    val processed = Bitmap.createBitmap(pixels, small, small, Bitmap.Config.ARGB_8888)
    return Bitmap.createScaledBitmap(processed, MeshTextureSize, MeshTextureSize, true)
}

private fun boxBlur(data: FloatArray, width: Int, height: Int, radius: Int, passes: Int) {
    val temp = FloatArray(data.size)
    repeat(passes) {
        for (y in 0 until height) for (x in 0 until width) {
            var sum = 0f
            for (k in -radius..radius) sum += data[y * width + (x + k).coerceIn(0, width - 1)]
            temp[y * width + x] = sum / (radius * 2 + 1)
        }
        for (y in 0 until height) for (x in 0 until width) {
            var sum = 0f
            for (k in -radius..radius) sum += temp[(y + k).coerceIn(0, height - 1) * width + x]
            data[y * width + x] = sum / (radius * 2 + 1)
        }
    }
}
