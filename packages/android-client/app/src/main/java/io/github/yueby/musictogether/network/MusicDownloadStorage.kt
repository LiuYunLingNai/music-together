package io.github.yueby.musictogether.network

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import io.github.yueby.musictogether.model.DEFAULT_MUSIC_DOWNLOAD_DIRECTORY
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream

internal data class ResolvedMusicDownloadDirectory(
    val absolutePath: String,
    val mediaStoreRelativePath: String,
)

internal class PendingMusicDownload internal constructor(
    val output: OutputStream,
    val fileName: String,
    val displayPath: String,
    val playbackUri: String,
    private val completeAction: () -> Unit,
    private val abortAction: () -> Unit,
) {
    fun complete() = completeAction()
    fun abort() = abortAction()
}

internal class MusicDownloadStorage(private val context: Context) {
    private val resolver = context.contentResolver

    fun create(directoryPath: String, fileName: String, mimeType: String): PendingMusicDownload {
        val directory = resolveMusicDownloadDirectory(directoryPath)
            ?: throw IOException("下载目录必须位于 $PUBLIC_DOWNLOAD_ROOT")
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            createMediaStoreDownload(directory, fileName, mimeType)
        } else {
            createLegacyDownload(directory, fileName, mimeType)
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun createMediaStoreDownload(
        directory: ResolvedMusicDownloadDirectory,
        fileName: String,
        mimeType: String,
    ): PendingMusicDownload {
        val safeName = uniqueMediaStoreName(directory.mediaStoreRelativePath, fileName)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, "${directory.mediaStoreRelativePath}/")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("无法在下载目录创建文件")
        val output = resolver.openOutputStream(uri, "w") ?: run {
            resolver.delete(uri, null, null)
            throw IOException("无法打开下载文件")
        }
        return PendingMusicDownload(
            output = output,
            fileName = safeName,
            displayPath = "${directory.absolutePath}/$safeName",
            playbackUri = uri.toString(),
            completeAction = {
                resolver.update(
                    uri,
                    ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) },
                    null,
                    null,
                )
            },
            abortAction = {
                runCatching { output.close() }
                resolver.delete(uri, null, null)
            },
        )
    }

    @Suppress("DEPRECATION")
    private fun createLegacyDownload(
        directory: ResolvedMusicDownloadDirectory,
        fileName: String,
        mimeType: String,
    ): PendingMusicDownload {
        val folder = File(directory.absolutePath)
        if (!folder.exists() && !folder.mkdirs()) throw IOException("无法创建下载目录")
        if (!folder.isDirectory) throw IOException("下载路径不是文件夹")
        val file = uniqueFile(folder, fileName)
        val output = FileOutputStream(file)
        return PendingMusicDownload(
            output = output,
            fileName = file.name,
            displayPath = file.absolutePath,
            playbackUri = Uri.fromFile(file).toString(),
            completeAction = {
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
            },
            abortAction = {
                runCatching { output.close() }
                file.delete()
            },
        )
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun uniqueMediaStoreName(relativePath: String, requestedName: String): String {
        val existingNames = mutableSetOf<String>()
        resolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Downloads.DISPLAY_NAME),
            "${MediaStore.Downloads.RELATIVE_PATH}=?",
            arrayOf("$relativePath/"),
            null,
        )?.use { cursor ->
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
            while (cursor.moveToNext()) existingNames += cursor.getString(nameColumn)
        }
        return uniqueDownloadFileName(requestedName, existingNames)
    }
}

internal const val PUBLIC_DOWNLOAD_ROOT = "/storage/emulated/0/Download"

internal fun resolveMusicDownloadDirectory(value: String): ResolvedMusicDownloadDirectory? {
    val normalized = value.trim().replace('\\', '/').trimEnd('/')
    if (normalized.length !in 1..240) return null
    if (normalized != PUBLIC_DOWNLOAD_ROOT && !normalized.startsWith("$PUBLIC_DOWNLOAD_ROOT/")) return null
    val subPath = normalized.removePrefix(PUBLIC_DOWNLOAD_ROOT).trim('/')
    val segments = subPath.split('/').filter { it.isNotEmpty() }
    if (segments.any { it == "." || it == ".." || INVALID_PATH_CHARACTERS.containsMatchIn(it) }) return null
    val absolute = if (segments.isEmpty()) PUBLIC_DOWNLOAD_ROOT else "$PUBLIC_DOWNLOAD_ROOT/${segments.joinToString("/")}"
    val relative = if (segments.isEmpty()) "Download" else "Download/${segments.joinToString("/")}"
    return ResolvedMusicDownloadDirectory(absolute, relative)
}

internal fun normalizeMusicDownloadDirectory(value: String): String =
    resolveMusicDownloadDirectory(value)?.absolutePath ?: DEFAULT_MUSIC_DOWNLOAD_DIRECTORY

internal fun uniqueDownloadFileName(requestedName: String, existingNames: Set<String>): String {
    if (requestedName !in existingNames) return requestedName
    val dot = requestedName.lastIndexOf('.')
    val base = if (dot > 0) requestedName.substring(0, dot) else requestedName
    val extension = if (dot > 0) requestedName.substring(dot) else ""
    var index = 1
    while ("$base ($index)$extension" in existingNames) index += 1
    return "$base ($index)$extension"
}

private fun uniqueFile(directory: File, requestedName: String): File {
    val names = directory.list()?.toSet().orEmpty()
    return File(directory, uniqueDownloadFileName(requestedName, names))
}

private val INVALID_PATH_CHARACTERS = Regex("[<>:\"|?*\\u0000-\\u001f\\u007f]")
