package io.github.yueby.musictogether.logging

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import io.github.yueby.musictogether.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object AppLogger {
    private const val MAX_BYTES = 2L * 1024 * 1024
    private val lock = Any()
    private var logFile: File? = null
    private val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    fun initialize(context: Context) {
        if (!BuildConfig.DEBUG) return
        synchronized(lock) {
            val directory = File(context.filesDir, "logs").apply { mkdirs() }
            logFile = File(directory, "music-together-android.log")
            info("App", "logger initialized; version=${BuildConfig.VERSION_NAME} sdk=${android.os.Build.VERSION.SDK_INT}")
        }
    }

    fun debug(tag: String, message: String) = write("DEBUG", tag, message)
    fun info(tag: String, message: String) = write("INFO", tag, message)
    fun warn(tag: String, message: String) = write("WARN", tag, message)
    fun error(tag: String, message: String, throwable: Throwable? = null) {
        val detail = throwable?.let { " | ${it.javaClass.simpleName}: ${it.message}\n${it.stackTraceToString()}" }.orEmpty()
        write("ERROR", tag, message + detail)
    }

    fun export(context: Context) {
        if (!BuildConfig.DEBUG) return
        val source = synchronized(lock) { logFile } ?: return
        val exportFile = File(context.cacheDir, "music-together-android-log.txt")
        synchronized(lock) {
            val previous = File(source.parentFile, "music-together-android.previous.log")
            exportFile.bufferedWriter().use { writer ->
                if (previous.exists()) {
                    writer.appendLine("===== previous log =====")
                    previous.forEachLine { writer.appendLine(it) }
                }
                writer.appendLine("===== current log =====")
                if (source.exists()) source.forEachLine { writer.appendLine(it) } else writer.appendLine("No logs yet.")
            }
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", exportFile)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Music Together Android 日志")
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "导出客户端日志"))
    }

    fun clear(): Boolean {
        if (!BuildConfig.DEBUG) return false
        return synchronized(lock) {
            val current = logFile ?: return@synchronized false
            val previous = File(current.parentFile, "music-together-android.previous.log")
            runCatching {
                if (current.exists()) current.delete()
                if (previous.exists()) previous.delete()
                current.writeText("")
                true
            }.getOrDefault(false)
        }
    }

    private fun write(level: String, tag: String, message: String) {
        if (!BuildConfig.DEBUG) return
        synchronized(lock) {
            val file = logFile ?: return
            runCatching {
                rotateIfNeeded(file)
                val safe = message.replace(Regex("mt_identity=[^;\\s]+"), "mt_identity=<redacted>")
                file.appendText("${timestamp.format(Date())} [$level] [$tag] $safe\n")
            }
        }
    }

    private fun rotateIfNeeded(file: File) {
        if (!file.exists() || file.length() < MAX_BYTES) return
        val previous = File(file.parentFile, "music-together-android.previous.log")
        if (previous.exists()) previous.delete()
        file.renameTo(previous)
    }
}
