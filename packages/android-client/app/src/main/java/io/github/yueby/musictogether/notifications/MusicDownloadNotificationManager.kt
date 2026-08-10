package io.github.yueby.musictogether.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.yueby.musictogether.MainActivity
import io.github.yueby.musictogether.R
import io.github.yueby.musictogether.logging.AppLogger
import java.util.Locale

internal class MusicDownloadNotificationManager(context: Context) {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)
    private var permissionWarningLogged = false

    init {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "音乐下载",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Music Together 音乐下载进度"
            setSound(null, null)
        }
        appContext.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun showProgress(
        title: String,
        downloadedBytes: Long,
        totalBytes: Long?,
        currentBytesPerSecond: Long?,
    ) {
        val progress = totalBytes?.takeIf { it > 0 }
            ?.let { ((downloadedBytes * 100L) / it).toInt().coerceIn(0, 100) }
        val transferred = if (totalBytes != null) {
            "${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}"
        } else {
            "已下载 ${formatBytes(downloadedBytes)}"
        }
        val text = listOfNotNull(
            transferred,
            currentBytesPerSecond?.takeIf { it > 0 }?.let(::formatDownloadSpeed),
        ).joinToString(" · ")
        val notification = baseBuilder()
            .setContentTitle("正在下载：$title")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, progress ?: 0, progress == null)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        notify(notification)
    }

    fun showCompleted(title: String, displayPath: String, averageBytesPerSecond: Long?) {
        val averageSpeed = averageBytesPerSecond?.takeIf { it > 0 }
            ?.let { "平均速度 ${formatDownloadSpeed(it)}" }
        val text = listOfNotNull(averageSpeed, displayPath).joinToString(" · ")
        notify(
            baseBuilder()
                .setContentTitle("下载完成：$title")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setOngoing(false)
                .setAutoCancel(true)
                .setProgress(0, 0, false)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .build(),
        )
    }

    fun showFailed(title: String, message: String) {
        notify(
            baseBuilder()
                .setContentTitle("下载失败：$title")
                .setContentText(message)
                .setOngoing(false)
                .setAutoCancel(true)
                .setProgress(0, 0, false)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build(),
        )
    }

    fun showCancelled(title: String) {
        notify(
            baseBuilder()
                .setContentTitle("下载已取消：$title")
                .setOngoing(false)
                .setAutoCancel(true)
                .setProgress(0, 0, false)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .build(),
        )
    }

    private fun baseBuilder(): NotificationCompat.Builder = NotificationCompat.Builder(appContext, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher)
        .setContentIntent(contentIntent())
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)

    private fun contentIntent(): PendingIntent {
        val intent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            appContext,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun notify(notification: Notification) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            if (!permissionWarningLogged) {
                permissionWarningLogged = true
                AppLogger.warn("Notification", "download notification permission not granted")
            }
            return
        }
        permissionWarningLogged = false
        manager.notify(NOTIFICATION_ID, notification)
    }

    private companion object {
        const val CHANNEL_ID = "music_together_downloads"
        const val NOTIFICATION_ID = 4201
    }
}

internal fun formatDownloadSpeed(bytesPerSecond: Long): String = "${formatBytes(bytesPerSecond)}/s"

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L * 1024L ->
        String.format(Locale.ROOT, "%.1f GB", bytes.toDouble() / (1024L * 1024L * 1024L))
    bytes >= 1024L * 1024L ->
        String.format(Locale.ROOT, "%.1f MB", bytes.toDouble() / (1024L * 1024L))
    bytes >= 1024L -> String.format(Locale.ROOT, "%.1f KB", bytes.toDouble() / 1024L)
    else -> "$bytes B"
}
