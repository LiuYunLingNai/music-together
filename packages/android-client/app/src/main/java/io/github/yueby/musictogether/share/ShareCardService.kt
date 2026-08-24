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
        val qr = QrCodeEncoder.encode(content.link)
        if (qr == null) AppLogger.warn("Share", "qr encode failed link=${content.link}")
        try {
            ShareCardRenderer.render(content, cover, qr)
        } finally {
            cover?.recycle()
        }
    }

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
        val request = Request.Builder().url(url).get().build()
        return runCatching {
            client.newCall(request).awaitResponse().use { response ->
                if (!response.isSuccessful) return@use null
                val bytes = response.body?.bytes() ?: return@use null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        }.onFailure { error ->
            AppLogger.warn("Share", "cover load failed: ${error.javaClass.simpleName}")
        }.getOrNull()
    }

    private companion object {
        const val SHARE_DIRECTORY = "shared_cards"
    }
}

internal fun shareImageIntent(uri: Uri, text: String): Intent = Intent(Intent.ACTION_SEND).apply {
    type = "image/png"
    clipData = ClipData.newUri(null, "Music Together 房间分享图片", uri)
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
