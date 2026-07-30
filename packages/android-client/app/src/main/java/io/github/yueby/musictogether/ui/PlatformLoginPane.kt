package io.github.yueby.musictogether.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.MyPlatformAuth
import io.github.yueby.musictogether.model.PlatformAuthStatus
import io.github.yueby.musictogether.model.QrLoginState

private val platformOptions = listOf(
    "netease" to "网易云",
    "tencent" to "QQ 音乐",
    "kugou" to "酷狗",
    "bilibili" to "B站",
)

@Composable
internal fun PlatformLoginCard(
    platform: String,
    myAuth: MyPlatformAuth?,
    roomAuth: PlatformAuthStatus?,
    statusLoaded: Boolean,
    onQrLogin: () -> Unit,
    onCookieLogin: () -> Unit,
    onLogout: () -> Unit,
    compactLabel: String?,
    onClaimConceptVip: (() -> Unit)?,
    isClaimingConceptVip: Boolean,
) {
    val loggedIn = myAuth?.loggedIn == true
    val displayedVipType = if (loggedIn) myAuth.vipType else roomAuth?.maxVipType ?: 0
    val displayedVipLabel = if (loggedIn) myAuth?.vipLabel else roomAuth?.maxVipLabel
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    compactLabel?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        when {
                            loggedIn -> myAuth?.nickname ?: "已登录"
                            !statusLoaded -> "验证登录中…"
                            else -> "未登录"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        if ((roomAuth?.loggedInCount ?: 0) > 0) {
                            "房间内 ${roomAuth?.loggedInCount} 人已登录${if (roomAuth?.hasVip == true) "，VIP 可用" else ""}"
                        } else {
                            "房间暂无人登录${platformLabel(platform)}"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (displayedVipType > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Star, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(4.dp))
                        Text(vipLabel(displayedVipType, displayedVipLabel), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            if (loggedIn) {
                if (onClaimConceptVip != null) {
                    FilledTonalButton(
                        onClick = onClaimConceptVip,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !isClaimingConceptVip,
                    ) {
                        if (isClaimingConceptVip) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Star, null)
                        }
                        Spacer(Modifier.width(6.dp))
                        Text(if (isClaimingConceptVip) "领取中…" else "领取每日畅听权益")
                    }
                }
                OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null)
                    Spacer(Modifier.width(6.dp))
                    Text("退出登录")
                }
            } else if (statusLoaded) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(onClick = onQrLogin, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.QrCodeScanner, null)
                        Spacer(Modifier.width(6.dp))
                        Text("扫码登录")
                    }
                    OutlinedButton(onClick = onCookieLogin, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Key, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Cookie")
                    }
                }
            }
        }
    }
}


@Composable
internal fun QrLoginDialog(qr: QrLoginState, viewModel: MusicTogetherViewModel) {
    val bitmap = remember(qr.imageData) { qr.imageData?.let(::decodeDataImage) }
    val statusText = when (qr.status) {
        800 -> "二维码已过期"
        801 -> "等待扫码"
        802 -> "已扫码，请在手机上确认"
        803 -> "登录成功"
        else -> qr.message ?: if (qr.loading) "正在生成二维码…" else "二维码生成失败"
    }
    AlertDialog(
        onDismissRequest = viewModel::closeQrLogin,
        title = { Text("${platformLabel(qr.platform)}扫码登录") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    if (qr.platform == "tencent") "使用手机 QQ 扫描二维码" else "使用${platformLabel(qr.platform)} App 扫描二维码",
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    Modifier.size(240.dp).clip(RoundedCornerShape(12.dp)).background(androidx.compose.ui.graphics.Color.White),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        qr.loading -> CircularProgressIndicator()
                        bitmap != null -> Image(
                            bitmap = bitmap,
                            contentDescription = "登录二维码",
                            modifier = Modifier.fillMaxSize().padding(8.dp),
                        )
                        !qr.imageData.isNullOrBlank() -> AsyncImage(
                            model = qr.imageData,
                            contentDescription = "登录二维码",
                            modifier = Modifier.fillMaxSize().padding(8.dp),
                            contentScale = ContentScale.Fit,
                        )
                        else -> Text("二维码生成失败", color = androidx.compose.ui.graphics.Color.DarkGray)
                    }
                }
                Text(
                    statusText,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    color = if (qr.status == 800) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        },
        confirmButton = {
            if (qr.status == 800 || (!qr.loading && qr.imageData == null)) {
                Button(onClick = { viewModel.requestQrLogin(qr.platform) }) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(4.dp))
                    Text("重新获取")
                }
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeQrLogin) { Text("关闭") } },
    )
}

private fun decodeDataImage(value: String): androidx.compose.ui.graphics.ImageBitmap? = runCatching {
    val encoded = value.substringAfter("base64,", "")
    if (encoded.isBlank()) return@runCatching null
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()
