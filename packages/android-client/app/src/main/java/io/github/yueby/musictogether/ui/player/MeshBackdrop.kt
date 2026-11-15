package io.github.yueby.musictogether.ui.player

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import coil3.BitmapImage
import coil3.SingletonImageLoader
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.allowHardware
import io.github.yueby.musictogether.player.AudioSpectrum
import io.github.yueby.musictogether.ui.coverNetworkHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** AMLL `mesh.frag.glsl`; the mesh's interpolated texture coordinate arrives as the shader coordinate. */
private const val MeshShaderSource = """
uniform shader album;
uniform float tex;
uniform float2 size;
uniform float volume;
uniform float sinAngle;
uniform float cosAngle;

half4 main(float2 uv) {
    float2 centered = uv - float2(0.2);
    float2 rotated = float2(
        cosAngle * centered.x - sinAngle * centered.y,
        sinAngle * centered.x + cosAngle * centered.y
    );
    float2 finalUv = rotated * max(0.001, 1.0 - volume * 2.0) + float2(0.5);
    half4 color = album.eval(finalUv * tex);
    float level = max(0.5, 1.0 - volume * 0.5);
    float noise = fract(52.9829189 * fract(dot(uv * size, float2(0.06711056, 0.00583715))));
    half3 rgb = color.rgb * level + (noise - 0.5) / 255.0;
    float vignette = 1.0 - smoothstep(0.3, 0.8, distance(uv, float2(0.5)));
    rgb *= 0.6 + vignette * 0.4;
    // Upstream also writes the level into alpha and blends over the page, which darkens once more.
    return half4(rgb * level, 1.0);
}
"""

private const val MeshTextureSize = 32
private val MeshFadeEasing = CubicBezierEasing(0.37f, 0f, 0.63f, 1f)

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class MeshLayerState(bitmap: Bitmap, private val geometry: MeshGeometry) {
    val alpha = Animatable(0f)
    val shader = RuntimeShader(MeshShaderSource).apply {
        val album = BitmapShader(bitmap, Shader.TileMode.MIRROR, Shader.TileMode.MIRROR)
        album.filterMode = BitmapShader.FILTER_MODE_LINEAR
        setInputShader("album", album)
        setFloatUniform("tex", bitmap.width.toFloat())
    }
    val paint = Paint().apply { shader = this@MeshLayerState.shader }
    private val vertices = FloatArray(geometry.positions.size)
    private var laidOutFor = Size.Unspecified

    /** AMLL `mesh.vert.glsl`: the square mesh is stretched along the longer side so it always covers. */
    fun vertices(size: Size): FloatArray {
        if (size == laidOutFor) return vertices
        laidOutFor = size
        val aspect = size.width / size.height
        val scaleX = if (aspect > 1f) 1f else 1f / aspect
        val scaleY = if (aspect > 1f) aspect else 1f
        val positions = geometry.positions
        for (i in positions.indices step 2) {
            vertices[i] = (positions[i] * scaleX + 1f) / 2f * size.width
            vertices[i + 1] = (1f - positions[i + 1] * scaleY) / 2f * size.height
        }
        return vertices
    }

    val uvs get() = geometry.uvs
    val indices get() = geometry.indices
}

/**
 * AMLL `MeshGradientRenderer`: the cover, reduced to a 32px colour field, is stretched over a bicubic Hermite
 * mesh picked per song; the shader spins the texture under the mesh and pulls it in with the low-frequency
 * level. A new song's mesh fades in over the previous one.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
internal fun MeshBackdrop(
    coverUrl: String?,
    videoUrl: String?,
    animate: Boolean,
    flowSpeed: Float,
    fps: Int,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val layers = remember { mutableStateListOf<MeshLayerState>() }
    LaunchedEffect(coverUrl, videoUrl) {
        // Upstream hands the renderer the video cover when there is one and samples a frame of it.
        val source = videoUrl?.let { videoFrame(it) } ?: coverUrl?.let {
            val request = ImageRequest.Builder(context)
                .data(it)
                .httpHeaders(coverNetworkHeaders)
                .size(64)
                .allowHardware(false)
                .build()
            (SingletonImageLoader.get(context).execute(request).image as? BitmapImage)?.bitmap
        }
        if (source == null) {
            if (coverUrl != null) return@LaunchedEffect
            coroutineScope {
                layers.forEach { launch { it.alpha.animateTo(0f, tween(550, easing = MeshFadeEasing)) } }
            }
            layers.clear()
            return@LaunchedEffect
        }
        val layer = withContext(Dispatchers.Default) {
            MeshLayerState(meshTexture(source), buildMeshGeometry(pickMeshPreset()))
        }
        layers += layer
        layer.alpha.animateTo(1f, tween(550, easing = MeshFadeEasing))
        layers.removeAll { it !== layer }
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

    Spacer(
        modifier.drawBehind {
            drawRect(Color(0xFF111214))
            // Upstream: `setLowFreqVolume` divides by ten, and the texture turns by (seconds / 10 + volume) * 2.
            val level = volume.floatValue / 10f
            val angle = (time.floatValue / 10f + level) * 2f
            drawIntoCanvas { canvas ->
                for (layer in layers) {
                    layer.shader.setFloatUniform("size", size.width, size.height)
                    layer.shader.setFloatUniform("volume", level)
                    layer.shader.setFloatUniform("sinAngle", sin(angle))
                    layer.shader.setFloatUniform("cosAngle", cos(angle))
                    layer.paint.alpha = (layer.alpha.value.coerceIn(0f, 1f) * 255).toInt()
                    val vertices = layer.vertices(size)
                    canvas.nativeCanvas.drawVertices(
                        Canvas.VertexMode.TRIANGLES, vertices.size, vertices, 0, layer.uvs, 0, null, 0,
                        layer.indices, 0, layer.indices.size, layer.paint,
                    )
                }
            }
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

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private suspend fun videoFrame(url: String): Bitmap? = withContext(Dispatchers.IO) {
    val retriever = MediaMetadataRetriever()
    try {
        retriever.setDataSource(url, emptyMap())
        retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 64, 64)
    } catch (_: Exception) {
        null
    } finally {
        runCatching { retriever.release() }
    }
}

private fun meshTexture(source: Bitmap): Bitmap {
    val small = MeshTextureSize
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
    return Bitmap.createBitmap(pixels, small, small, Bitmap.Config.ARGB_8888)
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
