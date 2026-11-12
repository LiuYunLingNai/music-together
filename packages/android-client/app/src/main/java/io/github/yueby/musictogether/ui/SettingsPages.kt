package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.ArrowUpDown
import com.composables.icons.lucide.AudioLines
import com.composables.icons.lucide.Eye
import com.composables.icons.lucide.ChevronsUpDown
import com.composables.icons.lucide.Droplet
import com.composables.icons.lucide.Image
import com.composables.icons.lucide.Languages
import com.composables.icons.lucide.Link
import com.composables.icons.lucide.Palette
import com.composables.icons.lucide.QrCode
import com.composables.icons.lucide.SlidersHorizontal
import com.composables.icons.lucide.Sparkles
import com.composables.icons.lucide.Timer
import com.composables.icons.lucide.Type
import com.composables.icons.lucide.Vibrate
import com.composables.icons.lucide.Volume2
import io.github.yueby.musictogether.player.PlaybackCommandBridge
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.composables.icons.lucide.Download
import com.composables.icons.lucide.Trash2
import top.yukonga.miuix.kmp.preference.ArrowPreference
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.ReplayGainMode
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.ShareCardBackgroundSource
import io.github.yueby.musictogether.model.ShareCardSettings
import io.github.yueby.musictogether.model.ThemeMode
import io.github.yueby.musictogether.ui.designsystem.AppButton
import io.github.yueby.musictogether.ui.designsystem.AppTextField
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.SliderPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable
internal fun SettingsList(content: LazyListScope.() -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().overScrollVertical(),
        contentPadding = PaddingValues(bottom = 24.dp),
        content = content,
    )
}

internal fun LazyListScope.settingsGroup(
    title: String?,
    key: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    item(key = key) {
        if (title != null) SmallTitle(text = title)
        Card(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 6.dp),
            content = content,
        )
    }
}

@Composable
private fun SettingIcon(icon: ImageVector) {
    Icon(icon, contentDescription = null, tint = MiuixTheme.colorScheme.onBackground)
}

@Composable
internal fun SettingSwitch(
    title: String,
    summary: String?,
    icon: ImageVector,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    SwitchPreference(
        title = title,
        summary = summary,
        startAction = { SettingIcon(icon) },
        checked = checked,
        onCheckedChange = onCheckedChange,
    )
}

@Composable
internal fun <T> SettingChoice(
    title: String,
    summary: String?,
    icon: ImageVector,
    entries: List<T>,
    selected: T,
    label: (T) -> String,
    onSelected: (T) -> Unit,
) {
    OverlayDropdownPreference(
        title = title,
        summary = summary,
        items = entries.map(label),
        startAction = { SettingIcon(icon) },
        selectedIndex = entries.indexOf(selected).coerceAtLeast(0),
        onSelectedIndexChange = { index -> entries.getOrNull(index)?.let(onSelected) },
    )
}

@Composable
internal fun SettingSlider(
    title: String,
    valueText: String,
    icon: ImageVector,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    onValueChange: (Float) -> Unit,
) {
    SliderPreference(
        value = value,
        onValueChange = onValueChange,
        title = title,
        valueText = valueText,
        valueRange = range,
        steps = steps,
        startAction = { SettingIcon(icon) },
    )
}

@Composable
internal fun AppearanceSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let(viewModel::setShareCardLocalImage)
    }
    SettingsList {
        settingsGroup("主题", "theme") {
            SettingChoice(
                "主题模式",
                "跟随系统、浅色或深色",
                Lucide.Palette,
                ThemeMode.entries.filterNot { it == ThemeMode.Amoled },
                if (state.themeMode == ThemeMode.Amoled) ThemeMode.Dark else state.themeMode,
                ThemeMode::label,
                viewModel::updateThemeMode,
            )
            SettingSwitch("纯黑背景", "深色模式下页面底层使用纯黑", Lucide.Palette, state.pureBlackBackground, viewModel::updatePureBlackBackground)
            SettingSwitch("系统动态色", "使用壁纸主色生成界面色板", Lucide.Palette, state.dynamicColor, viewModel::updateDynamicColor)
        }
        settingsGroup("界面效果", "effects") {
            SettingSwitch("界面模糊", "支持的设备上为悬浮组件提供背景模糊", Lucide.Droplet, state.appBlurEnabled, viewModel::updateAppBlur)
            SettingChoice("底栏样式", "标准底栏或悬浮胶囊", Lucide.SlidersHorizontal, BottomBarStyle.entries, state.bottomBarStyle, BottomBarStyle::label, viewModel::updateBottomBarStyle)
            if (state.bottomBarStyle == BottomBarStyle.Floating) {
                SettingSwitch("液态玻璃", "支持时为悬浮底栏启用实时折射", Lucide.Droplet, state.glassBottomBar, viewModel::updateGlassBottomBar)
            }
        }
        shareCardGroup(state.shareCardSettings, viewModel) { picker.launch("image/*") }
    }
}

private fun LazyListScope.shareCardGroup(
    settings: ShareCardSettings,
    viewModel: MusicTogetherViewModel,
    onPickImage: () -> Unit,
) {
    settingsGroup("分享卡片", "share-card") {
        SettingChoice(
            "背景来源",
            "渐变、歌曲封面、本地图片或网络图片",
            Lucide.Image,
            ShareCardBackgroundSource.entries,
            settings.backgroundSource,
            { it.label },
        ) { source -> viewModel.updateShareCardSettings { it.copy(backgroundSource = source) } }
        if (settings.backgroundSource == ShareCardBackgroundSource.LocalImage) {
            AppButton(
                "选择本地图片",
                onPickImage,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                primary = false,
            )
        }
        if (settings.backgroundSource == ShareCardBackgroundSource.Url) {
            AppTextField(
                settings.backgroundUrl,
                { value -> viewModel.updateShareCardSettings { it.copy(backgroundUrl = value) } },
                "背景图片 URL",
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                singleLine = true,
            )
        }
        SettingSlider("背景模糊", settings.backgroundBlur.toString(), Lucide.Droplet, settings.backgroundBlur.toFloat(), 0f..8f, 7) { value ->
            viewModel.updateShareCardSettings { it.copy(backgroundBlur = value.toInt()) }
        }
        SettingSlider("背景暗化", "${(settings.backgroundDim * 100).toInt()}%", Lucide.Palette, settings.backgroundDim, 0f..0.8f, 7) { value ->
            viewModel.updateShareCardSettings { it.copy(backgroundDim = value) }
        }
        SettingSwitch("显示歌曲封面", null, Lucide.Image, settings.showCover) { value ->
            viewModel.updateShareCardSettings { it.copy(showCover = value) }
        }
        SettingSwitch("显示二维码", "保留扫码加入房间的二维码", Lucide.QrCode, settings.showQrCode) { value ->
            viewModel.updateShareCardSettings { it.copy(showQrCode = value) }
        }
        SettingSwitch("显示房间链接", null, Lucide.Link, settings.showLink) { value ->
            viewModel.updateShareCardSettings { it.copy(showLink = value) }
        }
    }
}

@Composable
internal fun PlayerSettingsPage(settings: PlayerDisplaySettings, viewModel: MusicTogetherViewModel) {
    fun update(transform: (PlayerDisplaySettings) -> PlayerDisplaySettings) = viewModel.updatePlayerDisplaySettings(transform)
    SettingsList {
        settingsGroup("辅助歌词", "aux") {
            SettingSwitch("显示翻译", "在主歌词下方显示翻译", Lucide.Languages, settings.showTranslation) { v -> update { it.copy(showTranslation = v) } }
            SettingSwitch("显示音译", "显示罗马音或逐词音译", Lucide.Languages, settings.showRomanization) { v -> update { it.copy(showRomanization = v) } }
        }
        settingsGroup("排版", "layout") {
            SettingSlider("歌词大小", "${(settings.lyricFontScale * 100).toInt()}%", Lucide.Type, settings.lyricFontScale, 0.8f..1.3f, 9) { v ->
                update { it.copy(lyricFontScale = v) }
            }
            SettingSlider("歌词字重", settings.lyricFontWeight.toString(), Lucide.Type, settings.lyricFontWeight.toFloat(), 400f..800f, 3) { v ->
                update { it.copy(lyricFontWeight = v.toInt()) }
            }
            SettingSlider("当前行位置", "${(settings.lyricAlignPosition * 100).toInt()}%", Lucide.ChevronsUpDown, settings.lyricAlignPosition, 0.05f..0.45f, 7) { v ->
                update { it.copy(lyricAlignPosition = v) }
            }
            SettingSlider("翻译大小", "${(settings.lyricSubFontScale * 100).toInt()}%", Lucide.Type, settings.lyricSubFontScale, 0.7f..1.3f, 5) { v ->
                update { it.copy(lyricSubFontScale = v) }
            }
            SettingSlider("音译大小", "${(settings.lyricRomanFontScale * 100).toInt()}%", Lucide.Type, settings.lyricRomanFontScale, 0.7f..1.3f, 5) { v ->
                update { it.copy(lyricRomanFontScale = v) }
            }
        }
        settingsGroup("歌词", "lyric") {
            SettingSwitch("隐藏已播放歌词", "已唱过的歌词行淡出，只保留当前和后续行", Lucide.Eye, settings.lyricHidePassedLines) { v ->
                update { it.copy(lyricHidePassedLines = v) }
            }
            SettingSwitch("音译显示在翻译上方", "同时显示翻译与音译时调换顺序", Lucide.ArrowUpDown, settings.lyricSwapTransRoman) { v ->
                update { it.copy(lyricSwapTransRoman = v) }
            }
            SettingSlider("逐词渐变宽度", "${"%.2f".format(settings.lyricWordFadeWidth)} 倍行高", Lucide.Type, settings.lyricWordFadeWidth, 0.05f..1f, 18) { v ->
                update { it.copy(lyricWordFadeWidth = v) }
            }
        }
        settingsGroup("封面", "cover") {
            SettingSwitch("沉浸封面", "竖屏封面视图铺满舞台并向下渐隐，暂停时轻微缩小", Lucide.Sparkles, settings.immersiveCover) { v ->
                update { it.copy(immersiveCover = v) }
            }
            SettingSwitch("动态封面", "竖屏沉浸封面播放平台提供的视频封面；关闭可减少视频解码与耗电", Lucide.Image, settings.dynamicCover) { v ->
                update { it.copy(dynamicCover = v) }
            }
            SettingSwitch("换歌过渡", "换歌时封面与歌名做约 0.5 秒的交叉淡化", Lucide.Sparkles, settings.songHandoff) { v ->
                update { it.copy(songHandoff = v) }
            }
            SettingSwitch("歌词自动对齐封面", "横屏时当前歌词行对齐封面中心", Lucide.ChevronsUpDown, settings.lyricAutoAlign) { v ->
                update { it.copy(lyricAutoAlign = v) }
            }
        }
        settingsGroup("控制栏", "controls") {
            SettingSwitch("控制栏频谱", "在播放按钮上方显示实时频谱，仅分析本机输出、不改动音频", Lucide.AudioLines, settings.controlsSpectrum) { v ->
                update { it.copy(controlsSpectrum = v) }
            }
            SettingSwitch("显示剩余时间", "进度左侧显示剩余时长，点按时间也可以切换", Lucide.Timer, settings.showRemainingTime) { v ->
                update { it.copy(showRemainingTime = v) }
            }
        }
        settingsGroup("动画与背景", "motion") {
            SettingSwitch("弹簧动画", "AMLL 风格的物理行切换", Lucide.Sparkles, settings.lyricSpringAnimation) { v -> update { it.copy(lyricSpringAnimation = v) } }
            SettingSwitch("当前行缩放", "突出当前播放的歌词行", Lucide.Sparkles, settings.lyricScaleEffect) { v -> update { it.copy(lyricScaleEffect = v) } }
            SettingSwitch("非当前行模糊", "更接近 AMLL，会增加渲染负担", Lucide.Droplet, settings.lyricBlurEffect) { v -> update { it.copy(lyricBlurEffect = v) } }
            SettingSwitch("背景流动", "封面取色的流动渐变背景，随低频鼓点脉动", Lucide.Sparkles, settings.backgroundMotion) { v -> update { it.copy(backgroundMotion = v) } }
            if (settings.backgroundMotion) {
                SettingSlider("流动速度", "${(settings.backgroundMotionStrength * 100).toInt()}%", Lucide.Sparkles, settings.backgroundMotionStrength, 0.5f..1.5f, 9) { v ->
                    update { it.copy(backgroundMotionStrength = v) }
                }
                val fpsOptions = listOf(15, 30, 60)
                SettingSlider("背景帧率", "${settings.backgroundFps} FPS", Lucide.Sparkles, fpsOptions.indexOf(settings.backgroundFps).coerceAtLeast(0).toFloat(), 0f..2f, 1) { v ->
                    update { it.copy(backgroundFps = fpsOptions[v.toInt().coerceIn(0, 2)]) }
                }
            }
        }
    }
}

@Composable
internal fun GeneralSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    val onAudioMixingChanged = rememberHapticValueChange(viewModel::updateAllowAudioMixing)
    val onHapticFeedbackChanged = rememberHapticValueChange(viewModel::updateHapticFeedbackEnabled)
    SettingsList {
        settingsGroup(null, "general") {
            SettingSwitch(
                "与其他应用同时播放",
                "不请求音频焦点，不主动暂停或压低其他媒体",
                Lucide.Volume2,
                state.allowAudioMixing,
                onAudioMixingChanged,
            )
            SettingSwitch(
                "触感反馈",
                "点击按钮、导航项和卡片时轻微震动",
                Lucide.Vibrate,
                state.hapticFeedbackEnabled,
                onHapticFeedbackChanged,
            )
        }
        settingsGroup("歌词来源", "lyrics") {
            SettingSwitch("TTML 在线逐词歌词", "优先尝试在线逐词歌词库，关闭后只用平台歌词；下一首起生效", Lucide.Languages, state.ttmlLyricsEnabled, viewModel::updateTtmlLyricsEnabled)
        }
        settingsGroup("音效", "audio") {
            SettingSwitch("均衡器", "使用系统均衡器，仅影响本机输出", Lucide.SlidersHorizontal, state.equalizerEnabled) { v ->
                viewModel.updateEqualizer(v, state.equalizerPreset)
            }
            val presets = PlaybackCommandBridge.equalizerPresets
            if (state.equalizerEnabled && presets.size > 1) {
                val index = state.equalizerPreset.coerceIn(0, presets.lastIndex)
                SettingSlider("均衡器预设", presets[index], Lucide.AudioLines, index.toFloat(), 0f..presets.lastIndex.toFloat(), presets.size - 2) { v ->
                    viewModel.updateEqualizer(true, v.toInt().coerceIn(0, presets.lastIndex))
                }
            }
        }
        settingsGroup("响度与缓存", "cache") {
            SettingChoice(
                "响度平衡",
                "把不同歌曲调到相近音量；智能模式没有测量结果时先轻微压低",
                Lucide.Volume2,
                ReplayGainMode.entries,
                state.replayGainMode,
                { mode -> when (mode) { ReplayGainMode.Off -> "关闭"; ReplayGainMode.Track -> "按曲目"; ReplayGainMode.Auto -> "智能" } },
                viewModel::updateReplayGainMode,
            )
            SettingSwitch("媒体缓存", "播放时边听边存，重复播放不再联网；流量计费网络下不会自动预取", Lucide.Download, state.mediaCacheEnabled) { v ->
                viewModel.updateMediaCache(enabled = v)
            }
            if (state.mediaCacheEnabled) {
                val limits = listOf(256, 512, 1024, 2048)
                SettingChoice("缓存上限", "超出后按最近最少使用清理，修改后重启应用生效", Lucide.Download, limits, state.mediaCacheLimitMb.takeIf { it in limits } ?: 512, { "$it MB" }) { v ->
                    viewModel.updateMediaCache(limitMb = v)
                }
                SettingSwitch("预加载下一首", "播放时提前下载队列里的下一首，切歌无空白", Lucide.Download, state.preloadNextTrack) { v ->
                    viewModel.updateMediaCache(preload = v)
                }
                var usage by remember { mutableStateOf(viewModel.mediaCacheUsageBytes()) }
                ArrowPreference(
                    title = "清除媒体缓存",
                    summary = "已占用 ${usage / (1024 * 1024)} MB",
                    startAction = { Icon(Lucide.Trash2, null, tint = MiuixTheme.colorScheme.onBackground) },
                    onClick = {
                        viewModel.clearMediaCache()
                        usage = viewModel.mediaCacheUsageBytes()
                    },
                )
            }
        }
        settingsGroup("睡眠定时", "sleep") {
            val sleep by viewModel.sleepTimer.collectAsStateWithLifecycle()
            val options = listOf(0, 15, 30, 45, 60, 90, 120)
            val label = when {
                sleep.held -> "已停止本机播放，点播放键恢复"
                sleep.minutes > 0 -> "${sleep.minutes} 分钟后停止本机播放"
                else -> "关闭"
            }
            SettingSlider("睡眠定时", label, Lucide.Timer, options.indexOf(sleep.minutes).coerceAtLeast(0).toFloat(), 0f..(options.size - 1).toFloat(), options.size - 2) { v ->
                viewModel.armSleepTimer(options[v.toInt().coerceIn(0, options.lastIndex)])
            }
        }
    }
}

private val ShareCardBackgroundSource.label: String
    get() = when (this) {
        ShareCardBackgroundSource.Gradient -> "动态渐变"
        ShareCardBackgroundSource.TrackCover -> "歌曲封面"
        ShareCardBackgroundSource.LocalImage -> "本地图片"
        ShareCardBackgroundSource.Url -> "网络图片"
    }

private val ThemeMode.label: String
    get() = when (this) {
        ThemeMode.System -> "跟随系统"
        ThemeMode.Light -> "浅色"
        ThemeMode.Dark -> "深色"
        ThemeMode.Amoled -> "AMOLED"
    }

private val BottomBarStyle.label: String
    get() = when (this) {
        BottomBarStyle.Standard -> "标准"
        BottomBarStyle.Floating -> "悬浮"
    }
