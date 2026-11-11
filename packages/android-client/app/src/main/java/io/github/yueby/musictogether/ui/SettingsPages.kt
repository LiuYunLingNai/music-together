package io.github.yueby.musictogether.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.BlurOn
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Vibration
import androidx.compose.material.icons.filled.VerticalAlignCenter
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
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
                Icons.Default.ColorLens,
                ThemeMode.entries.filterNot { it == ThemeMode.Amoled },
                if (state.themeMode == ThemeMode.Amoled) ThemeMode.Dark else state.themeMode,
                ThemeMode::label,
                viewModel::updateThemeMode,
            )
            SettingSwitch("纯黑背景", "深色模式下页面底层使用纯黑", Icons.Default.ColorLens, state.pureBlackBackground, viewModel::updatePureBlackBackground)
            SettingSwitch("系统动态色", "使用壁纸主色生成界面色板", Icons.Default.Palette, state.dynamicColor, viewModel::updateDynamicColor)
        }
        settingsGroup("界面效果", "effects") {
            SettingSwitch("界面模糊", "支持的设备上为悬浮组件提供背景模糊", Icons.Default.BlurOn, state.appBlurEnabled, viewModel::updateAppBlur)
            SettingChoice("底栏样式", "标准底栏或悬浮胶囊", Icons.Default.Tune, BottomBarStyle.entries, state.bottomBarStyle, BottomBarStyle::label, viewModel::updateBottomBarStyle)
            if (state.bottomBarStyle == BottomBarStyle.Floating) {
                SettingSwitch("液态玻璃", "支持时为悬浮底栏启用实时折射", Icons.Default.BlurOn, state.glassBottomBar, viewModel::updateGlassBottomBar)
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
            Icons.Default.Image,
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
        SettingSlider("背景模糊", settings.backgroundBlur.toString(), Icons.Default.BlurOn, settings.backgroundBlur.toFloat(), 0f..8f, 7) { value ->
            viewModel.updateShareCardSettings { it.copy(backgroundBlur = value.toInt()) }
        }
        SettingSlider("背景暗化", "${(settings.backgroundDim * 100).toInt()}%", Icons.Default.ColorLens, settings.backgroundDim, 0f..0.8f, 7) { value ->
            viewModel.updateShareCardSettings { it.copy(backgroundDim = value) }
        }
        SettingSwitch("显示歌曲封面", null, Icons.Default.Image, settings.showCover) { value ->
            viewModel.updateShareCardSettings { it.copy(showCover = value) }
        }
        SettingSwitch("显示二维码", "保留扫码加入房间的二维码", Icons.Default.QrCode, settings.showQrCode) { value ->
            viewModel.updateShareCardSettings { it.copy(showQrCode = value) }
        }
        SettingSwitch("显示房间链接", null, Icons.Default.Link, settings.showLink) { value ->
            viewModel.updateShareCardSettings { it.copy(showLink = value) }
        }
    }
}

@Composable
internal fun PlayerSettingsPage(settings: PlayerDisplaySettings, viewModel: MusicTogetherViewModel) {
    fun update(transform: (PlayerDisplaySettings) -> PlayerDisplaySettings) = viewModel.updatePlayerDisplaySettings(transform)
    SettingsList {
        settingsGroup("辅助歌词", "aux") {
            SettingSwitch("显示翻译", "在主歌词下方显示翻译", Icons.Default.Translate, settings.showTranslation) { v -> update { it.copy(showTranslation = v) } }
            SettingSwitch("显示音译", "显示罗马音或逐词音译", Icons.Default.Translate, settings.showRomanization) { v -> update { it.copy(showRomanization = v) } }
        }
        settingsGroup("排版", "layout") {
            SettingSlider("歌词大小", "${(settings.lyricFontScale * 100).toInt()}%", Icons.Default.FormatSize, settings.lyricFontScale, 0.8f..1.3f, 9) { v ->
                update { it.copy(lyricFontScale = v) }
            }
            SettingSlider("歌词字重", settings.lyricFontWeight.toString(), Icons.Default.FormatSize, settings.lyricFontWeight.toFloat(), 400f..800f, 3) { v ->
                update { it.copy(lyricFontWeight = v.toInt()) }
            }
            SettingSlider("当前行位置", "${(settings.lyricAlignPosition * 100).toInt()}%", Icons.Default.VerticalAlignCenter, settings.lyricAlignPosition, 0.05f..0.45f, 7) { v ->
                update { it.copy(lyricAlignPosition = v) }
            }
        }
        settingsGroup("封面", "cover") {
            SettingSwitch("沉浸封面", "竖屏封面视图铺满舞台并向下渐隐，暂停时轻微缩小", Icons.Default.Animation, settings.immersiveCover) { v ->
                update { it.copy(immersiveCover = v) }
            }
        }
        settingsGroup("控制栏", "controls") {
            SettingSwitch("控制栏频谱", "在播放按钮上方显示实时频谱，仅分析本机输出、不改动音频", Icons.Default.GraphicEq, settings.controlsSpectrum) { v ->
                update { it.copy(controlsSpectrum = v) }
            }
            SettingSwitch("显示剩余时间", "进度左侧显示剩余时长，点按时间也可以切换", Icons.Default.Timer, settings.showRemainingTime) { v ->
                update { it.copy(showRemainingTime = v) }
            }
        }
        settingsGroup("动画与背景", "motion") {
            SettingSwitch("弹簧动画", "AMLL 风格的物理行切换", Icons.Default.Animation, settings.lyricSpringAnimation) { v -> update { it.copy(lyricSpringAnimation = v) } }
            SettingSwitch("当前行缩放", "突出当前播放的歌词行", Icons.Default.Animation, settings.lyricScaleEffect) { v -> update { it.copy(lyricScaleEffect = v) } }
            SettingSwitch("非当前行模糊", "更接近 AMLL，会增加渲染负担", Icons.Default.BlurOn, settings.lyricBlurEffect) { v -> update { it.copy(lyricBlurEffect = v) } }
            SettingSwitch("流体封面背景", "缓慢流动的封面取色背景", Icons.Default.Animation, settings.backgroundMotion) { v -> update { it.copy(backgroundMotion = v) } }
            if (settings.backgroundMotion) {
                SettingSlider("背景运动强度", "${(settings.backgroundMotionStrength * 100).toInt()}%", Icons.Default.Animation, settings.backgroundMotionStrength, 0.5f..1.5f, 9) { v ->
                    update { it.copy(backgroundMotionStrength = v) }
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
                Icons.Default.PlayCircle,
                state.allowAudioMixing,
                onAudioMixingChanged,
            )
            SettingSwitch(
                "触感反馈",
                "点击按钮、导航项和卡片时轻微震动",
                Icons.Default.Vibration,
                state.hapticFeedbackEnabled,
                onHapticFeedbackChanged,
            )
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
