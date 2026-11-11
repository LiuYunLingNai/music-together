package io.github.yueby.musictogether.ui

import androidx.compose.runtime.Composable
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.MyPlatformAuth
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.preference.SwitchPreference

@Composable
internal fun PlatformPrivacyPreferences(auth: MyPlatformAuth, pending: Set<String>, viewModel: MusicTogetherViewModel) {
    Card {
        SwitchPreference(
            title = "共享${platformLabel(auth.platform)}账号权益",
            summary = when {
                auth.shareWithRoom == null -> "当前服务端不支持调整共享设置"
                "${auth.platform}:shareWithRoom" in pending -> "等待服务端确认…"
                else -> "关闭后仅本人点歌、私人歌单和漫游可用，不会退出账号"
            },
            checked = auth.shareWithRoom ?: true,
            enabled = auth.shareWithRoom != null && "${auth.platform}:shareWithRoom" !in pending,
            onCheckedChange = { viewModel.setPlatformSharing(auth.platform, it) },
        )
        if (auth.platform == "netease") {
            SwitchPreference(
                title = "网易云听歌打卡",
                summary = when {
                    auth.reportListening == null -> "当前服务端不支持听歌打卡"
                    "netease:reportListening" in pending -> "等待服务端确认…"
                    else -> "默认关闭；开启后由服务端向当前在线的供源账号上报有效播放记录"
                },
                checked = auth.reportListening ?: false,
                enabled = auth.reportListening != null && "netease:reportListening" !in pending,
                onCheckedChange = viewModel::setListeningReport,
            )
        }
    }
}
