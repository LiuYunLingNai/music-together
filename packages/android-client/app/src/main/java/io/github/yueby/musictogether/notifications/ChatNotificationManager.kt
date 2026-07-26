package io.github.yueby.musictogether.notifications

import android.Manifest
import android.app.NotificationChannel
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
import io.github.yueby.musictogether.model.ChatMessage

class ChatNotificationManager(context: Context) {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)
    private val recentMessages = ArrayDeque<String>()
    private var unreadCount = 0

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "聊天室消息",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Music Together 房间聊天消息"
            }
            appContext.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    fun show(roomName: String, message: ChatMessage) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            AppLogger.warn("Notification", "chat notification permission not granted")
            return
        }

        unreadCount += 1
        recentMessages += "${message.nickname}：${message.content}"
        while (recentMessages.size > 5) recentMessages.removeFirst()

        val intent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = if (unreadCount == 1) {
            "${message.nickname} · $roomName"
        } else {
            "$roomName · $unreadCount 条新消息"
        }
        val style = NotificationCompat.InboxStyle()
            .setBigContentTitle(title)
            .also { inbox -> recentMessages.forEach(inbox::addLine) }

        val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title)
            .setContentText(message.content)
            .setStyle(style)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(unreadCount > 1)
            .build()

        manager.notify(NOTIFICATION_ID, notification)
        AppLogger.info("Notification", "chat notification shown unread=$unreadCount")
    }

    fun clear() {
        unreadCount = 0
        recentMessages.clear()
        manager.cancel(NOTIFICATION_ID)
    }

    private companion object {
        const val CHANNEL_ID = "music_together_chat"
        const val NOTIFICATION_ID = 4101
    }
}
