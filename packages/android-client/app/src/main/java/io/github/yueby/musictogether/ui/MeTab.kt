package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ConnectionStatus
import io.github.yueby.musictogether.ui.designsystem.AppTabPage
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun MeTab(state: AppState, viewModel: MusicTogetherViewModel, bottomPadding: Dp) {
    val navigator = LocalAppNavigator.current
    val context = LocalContext.current
    val profile = state.accountProfile
    val connectedCount = state.servers.count { it.status == ConnectionStatus.Connected }
    val loggedPlatforms = state.platformHub.myAuth.filter { it.loggedIn }.map { platformLabel(it.platform) }

    AppTabPage(title = "我的", bottomPadding = bottomPadding) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().overScrollVertical(),
            contentPadding = PaddingValues(bottom = padding.calculateBottomPadding() + 16.dp),
        ) {
            item(key = "account") {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    onClick = { navigator.open(AppRoute.Account) },
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(56.dp).clip(CircleShape).background(MiuixTheme.colorScheme.secondaryContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (profile?.avatarUrl != null) {
                                AsyncImage(
                                    model = profile.avatarUrl,
                                    contentDescription = "头像",
                                    modifier = Modifier.size(56.dp).clip(CircleShape),
                                    contentScale = ContentScale.Crop,
                                )
                            } else {
                                Icon(Icons.Default.Person, null, tint = MiuixTheme.colorScheme.onSecondaryContainer)
                            }
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                profile?.nickname?.takeIf { it.isNotBlank() } ?: state.nickname.ifBlank { "未登录" },
                                style = MiuixTheme.textStyles.title3,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when {
                                    profile == null -> "连接服务器后自动创建身份"
                                    !profile.hasPassword -> "未设置密码 · 设置后可跨设备找回账号和歌单"
                                    else -> "账号与安全"
                                },
                                style = MiuixTheme.textStyles.body2,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                                maxLines = 2,
                            )
                        }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MiuixTheme.colorScheme.onSurfaceVariantActions)
                    }
                }
            }
            item(key = "music") {
                MeGroup("音乐与连接") {
                    MeEntry(
                        Icons.Default.MusicNote,
                        "音乐平台账号",
                        when {
                            state.room == null -> "在房间内登录和管理"
                            loggedPlatforms.isEmpty() -> "未登录"
                            else -> loggedPlatforms.joinToString("、")
                        },
                    ) { navigator.open(AppRoute.PlatformAccounts) }
                    MeEntry(Icons.Default.Dns, "服务器连接", "$connectedCount/${state.servers.size} 台在线") {
                        navigator.open(AppRoute.Server)
                    }
                    if (state.room != null) {
                        MeEntry(Icons.Default.MeetingRoom, "房间与同步", state.room.name) { navigator.open(AppRoute.RoomInfo) }
                    }
                }
            }
            item(key = "personal") {
                MeGroup("个性化") {
                    MeEntry(Icons.Default.Palette, "外观与主题", "主题、模糊、底栏与分享卡片") { navigator.open(AppRoute.Appearance) }
                    MeEntry(Icons.Default.PlayCircle, "歌词与播放器", "字号、动画与背景") { navigator.open(AppRoute.PlayerDisplay) }
                    MeEntry(Icons.Default.Settings, "通用", "音频焦点与触感反馈") { navigator.open(AppRoute.General) }
                }
            }
            item(key = "about") {
                MeGroup("关于") {
                    MeEntry(Icons.Default.SystemUpdate, "应用更新", "当前版本 ${BuildConfig.VERSION_NAME}") { navigator.open(AppRoute.Updates) }
                    if (profile?.role == "admin") {
                        MeEntry(Icons.Default.AdminPanelSettings, "服务器管理", "账号、房间与代理策略") { navigator.open(AppRoute.Admin) }
                    }
                    if (BuildConfig.DEBUG) {
                        MeEntry(Icons.Default.BugReport, "导出日志", null) { AppLogger.export(context) }
                        MeEntry(Icons.Default.BugReport, "清空日志", null) { viewModel.clearLogs() }
                    }
                }
            }
        }
    }
}

@Composable
private fun MeGroup(title: String, content: @Composable () -> Unit) {
    SmallTitle(text = title)
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 6.dp)) { content() }
}

@Composable
private fun MeEntry(icon: ImageVector, title: String, summary: String?, onClick: () -> Unit) {
    val onHapticClick = rememberHapticClick(onClick)
    ArrowPreference(
        title = title,
        summary = summary,
        startAction = { Icon(icon, null, tint = MiuixTheme.colorScheme.onBackground) },
        onClick = onHapticClick,
    )
}
