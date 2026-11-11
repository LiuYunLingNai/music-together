package io.github.yueby.musictogether.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.PlaybackFailureState
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppDialog
import top.yukonga.miuix.kmp.basic.Text

@Composable
internal fun PlaybackFailureDialog(
    state: PlaybackFailureState,
    canRetry: Boolean,
    canControl: Boolean,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
    onDegrade: () -> Unit,
    onSwitchSource: () -> Unit,
    onSkip: () -> Unit,
) {
    val failure = state.event
    val source = when (failure.failure.source) {
        "netease" -> "网易云音乐"
        "tencent" -> "QQ 音乐"
        "kugou" -> "酷狗音乐"
        "kugou_concept" -> "酷狗概念版"
        "bilibili" -> "哔哩哔哩"
        else -> failure.failure.source
    }
    val reason = when (failure.failure.reason) {
        "sign-in-needed" -> "请登录 $source 账号后重试。"
        "subscription-required" -> "该曲目需要 $source 会员权限。"
        "purchase-required" -> "该曲目需要在 $source 购买后播放。"
        "region-restricted" -> "该曲目受地区限制。"
        "taken-down" -> "该曲目可能已下架。"
        "no-audio" -> "该曲目没有可用音频。"
        "not-playable" -> "$source 暂时无法提供这首歌的音频。"
        "unsupported-quality" -> "当前音质不可用，可尝试重新解析。"
        "rate-limited" -> "$source 请求过于频繁，请稍后重试。"
        "upstream-unreachable" -> "$source 暂时无法连接。"
        else -> "播放地址暂时不可用。"
    }
    AppDialog(
        title = "歌曲无法播放",
        onDismissRequest = onDismiss,
        confirmText = if (state.busy) "处理中…" else if (canRetry) "重试" else "关闭",
        onConfirm = if (canRetry) onRetry else onDismiss,
        confirmEnabled = !state.busy,
        dismissText = "关闭",
    ) {
        Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            Text("《${failure.track.title}》")
            Text(reason)
            state.message?.let { Text(it) }
            if (failure.nextAction == "skip") Text("服务端将自动跳过此曲，以房间播放状态为准。")
            if (canRetry) {
                AppButton("降低音质后重试", onDegrade, enabled = !state.busy, primary = false)
            } else {
                Text("请房主或管理员重试，或发起切歌投票。")
            }
            if (canControl) AppButton("尝试其他音源", onSwitchSource, enabled = !state.busy, primary = false)
            AppButton(if (canControl) "下一首" else "投票切歌", onSkip, enabled = !state.busy, primary = false)
        }
    }
}
