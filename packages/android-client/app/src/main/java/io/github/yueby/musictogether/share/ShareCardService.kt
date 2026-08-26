package io.github.yueby.musictogether.share

import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import io.github.yueby.musictogether.logging.AppLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class ShareCardService(private val client: OkHttpClient) {
    suspend fun render(content: ShareCardContent): Bitmap = withContext(Dispatchers.IO) {
        val cover = content.coverUrl?.let { loadCover(it) }
        val background = when (content.shareSettings.backgroundSource) {
            io.github.yueby.musictogether.model.ShareCardBackgroundSource.Gradient -> null
            io.github.yueby.musictogether.model.ShareCardBackgroundSource.TrackCover -> cover
            io.github.yueby.musictogether.model.ShareCardBackgroundSource.LocalImage ->
                content.shareSettings.localImagePath?.let { path -> loadLocalImage(path) }
            io.github.yueby.musictogether.model.ShareCardBackgroundSource.Url ->
                content.shareSettings.backgroundUrl.takeIf(String::isNotBlank)?.let { loadCover(it) }
        }
        val qr = QrCodeEncoder.encode(content.link)
        if (qr == null) AppLogger.warn("Share", "qr encode failed link=${content.link}")
        try {
            ShareCardRenderer.render(content, cover, background, qr)
        } finally {
            cover?.recycle()
            if (background !== cover) background?.recycle()
        }
    }

    private fun loadLocalImage(path: String): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        BitmapFactory.decodeFile(path, sampledOptions(bounds))
    }.onFailure { error ->
        AppLogger.warn("Share", "local background load failed: ${error.javaClass.simpleName}")
    }.getOrNull()

    suspend fun writeToCache(context: Context, bitmap: Bitmap, fileName: String): Uri =
        withContext(Dispatchers.IO) {
            val directory = File(context.cacheDir, SHARE_DIRECTORY).apply { mkdirs() }
            directory.listFiles()?.forEach { file ->
                if (file.isFile && file.name.endsWith(".png")) file.delete()
            }
            val target = File(directory, fileName)
            target.outputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            }
            FileProvider.getUriForFile(context, "${context.packageName}.files", target)
        }

    private suspend fun loadCover(url: String): Bitmap? {
        return runCatching {
            val request = Request.Builder().url(url).get().build()
            client.newCall(request).awaitResponse().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body ?: return@use null
                if (body.contentLength() > MAX_IMAGE_BYTES) return@use null
                val bytes = body.bytes()
                if (bytes.size > MAX_IMAGE_BYTES) return@use null
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, sampledOptions(bounds))
            }
        }.onFailure { error ->
            AppLogger.warn("Share", "cover load failed: ${error.javaClass.simpleName}")
        }.getOrNull()
    }

    private companion object {
        const val SHARE_DIRECTORY = "shared_cards"
        const val MAX_IMAGE_BYTES = 24 * 1024 * 1024
    }
}

private fun sampledOptions(bounds: BitmapFactory.Options): BitmapFactory.Options {
    var sampleSize = 1
    while (bounds.outWidth / sampleSize > 2048 || bounds.outHeight / sampleSize > 2048) sampleSize *= 2
    return BitmapFactory.Options().apply { inSampleSize = sampleSize }
}

internal fun shareImageIntent(uri: Uri, text: String): Intent = Intent(Intent.ACTION_SEND).apply {
    type = "image/png"
    // Do not use ClipData.newUri(null, ...): some Android/ROM implementations
    // dereference the resolver while building the description and crash when it
    // is null. A raw URI still grants the receiving app the same content URI.
    clipData = ClipData.newRawUri("Music Together 房间分享图片", uri)
    putExtra(Intent.EXTRA_SUBJECT, "Music Together 房间邀请")
    putExtra(Intent.EXTRA_STREAM, uri)
    putExtra(Intent.EXTRA_TEXT, text)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
}

private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) continuation.resume(response) else response.close()
        }
    })
}
