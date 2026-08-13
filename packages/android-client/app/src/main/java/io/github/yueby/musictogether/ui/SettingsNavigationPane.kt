package io.github.yueby.musictogether.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.add
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.BlurOn
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.SettingsEthernet
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Vibration
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.BottomBarStyle
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.ThemeMode
import io.github.yueby.musictogether.model.UiStyle
import io.github.yueby.musictogether.ui.designsystem.LocalUiStyle
import io.github.yueby.musictogether.ui.designsystem.LocalAppPageBackground
import io.github.yueby.musictogether.ui.designsystem.UiStyleSelector
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Icon as MiuixIcon
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.Scaffold as MiuixScaffold
import top.yukonga.miuix.kmp.basic.Slider as MiuixSlider
import top.yukonga.miuix.kmp.basic.SmallTopAppBar as MiuixSmallTopAppBar
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.preference.ArrowPreference
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

internal enum class SettingsDestination {
    Home,
    Account,
    Server,
    Appearance,
    Player,
    Playback,
    Updates,
    Downloads,
    General,
    Admin,
}

private data class SettingsCategory(
    val destination: SettingsDestination,
    val title: String,
    val summary: String,
    val icon: ImageVector,
)

@Composable
internal fun SettingsNavigationPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
    onExit: (() -> Unit)? = null,
    requestedDestination: SettingsDestination? = null,
    onRequestedDestinationConsumed: () -> Unit = {},
    onNavigationDepthChanged: (Boolean) -> Unit = {},
) {
    var destinationName by rememberSaveable { mutableStateOf(SettingsDestination.Home.name) }
    val destination = runCatching { SettingsDestination.valueOf(destinationName) }
        .getOrDefault(SettingsDestination.Home)
    val isAdmin = state.accountProfile?.role == "admin"

    LaunchedEffect(requestedDestination) {
        requestedDestination?.let {
            destinationName = it.name
            onRequestedDestinationConsumed()
        }
    }

    LaunchedEffect(destination) {
        onNavigationDepthChanged(destination != SettingsDestination.Home)
    }

    LaunchedEffect(destination, isAdmin) {
        if (destination == SettingsDestination.Admin && !isAdmin) {
            destinationName = SettingsDestination.Home.name
        } else if (destination == SettingsDestination.Admin) {
            viewModel.loadAdminData()
        }
    }
    BackHandler(enabled = destination != SettingsDestination.Home) {
        destinationName = SettingsDestination.Home.name
    }

    Box(Modifier.fillMaxSize()) {
    when (destination) {
        SettingsDestination.Home -> if (onExit == null) {
            SettingsHome(
                state = state,
                onOpen = { target -> destinationName = target.name },
            )
        } else {
            SettingsPage("设置", onBack = onExit) {
                SettingsHome(
                    state = state,
                    onOpen = { target -> destinationName = target.name },
                )
            }
        }
        SettingsDestination.Account -> SettingsPage("账号与安全", onBack = { destinationName = SettingsDestination.Home.name }) {
            AccountSection(state, viewModel)
        }
        SettingsDestination.Server -> SettingsPage(
            "服务器连接",
            onBack = { destinationName = SettingsDestination.Home.name },
        ) {
            ConnectionSettingsPane(state, viewModel)
        }
        SettingsDestination.Appearance -> SettingsPage("外观与主题", onBack = { destinationName = SettingsDestination.Home.name }) {
            AppearanceSettingsPage(state, viewModel)
        }
        SettingsDestination.Player -> SettingsPage("歌词与播放器", onBack = { destinationName = SettingsDestination.Home.name }) {
            PlayerSettingsPage(state.playerDisplaySettings, viewModel)
        }
        SettingsDestination.Playback -> SettingsPage("播放与同步", onBack = { destinationName = SettingsDestination.Home.name }) {
            PlaybackSettingsPage(state, viewModel)
        }
        SettingsDestination.Updates -> SettingsPage("应用更新", onBack = { destinationName = SettingsDestination.Home.name }) {
            AppUpdatePane(state, viewModel)
        }
        SettingsDestination.Downloads -> SettingsPage("下载与媒体库", onBack = { destinationName = SettingsDestination.Home.name }) {
            LocalMusicPane(
                state,
                viewModel,
                onBack = { destinationName = SettingsDestination.Home.name },
                showHeader = false,
            )
        }
        SettingsDestination.General -> SettingsPage("通用", onBack = { destinationName = SettingsDestination.Home.name }) {
            GeneralSettingsPage(state, viewModel)
        }
        SettingsDestination.Admin -> SettingsPage("服务器管理", onBack = { destinationName = SettingsDestination.Home.name }) {
            AdminManagementSection(state, viewModel)
        }
    }
    }
}

@Composable
private fun SettingsHome(
    state: AppState,
    onOpen: (SettingsDestination) -> Unit,
) {
    val categories = buildList {
        add(SettingsCategory(SettingsDestination.Account, "账号与安全", "资料、账号 ID、密码与登录", Icons.Default.AccountCircle))
        add(SettingsCategory(SettingsDestination.Server, "服务器连接", "添加、切换和管理服务器地址", Icons.Default.Dns))
        add(SettingsCategory(SettingsDestination.Appearance, "外观与主题", "界面风格、颜色、模糊与底栏", Icons.Default.Palette))
        add(SettingsCategory(SettingsDestination.Player, "歌词与播放器", "移动端歌词、动画、字号与背景", Icons.Default.PlayCircle))
        if (state.room != null) {
            add(SettingsCategory(SettingsDestination.Playback, "播放与同步", "房间播放、变速同步与网络间隔", Icons.Default.SettingsEthernet))
        }
        add(SettingsCategory(SettingsDestination.Updates, "应用更新", "检查版本、下载和安装更新", Icons.Default.SystemUpdate))
        add(SettingsCategory(SettingsDestination.Downloads, "下载与媒体库", "查看已下载歌曲和本地播放内容", Icons.Default.Download))
        add(SettingsCategory(SettingsDestination.General, "通用", "触感反馈与其他应用同时播放", Icons.Default.Settings))
        if (state.accountProfile?.role == "admin") {
            add(SettingsCategory(SettingsDestination.Admin, "服务器管理", "账号、房间与代理策略", Icons.Default.AdminPanelSettings))
        }
    }
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SettingsHero(
                    title = state.accountProfile?.nickname ?: "Music Together",
                    summary = "按类别管理应用与播放器设置",
                )
            }
            categories.forEach { category ->
                item(key = category.destination.name) {
                    val onHapticOpen = rememberHapticClick { onOpen(category.destination) }
                    SettingsCategoryCard(category, onClick = onHapticOpen)
                }
            }
        }

        UiStyle.Miuix -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                SettingsHero(
                    title = state.accountProfile?.nickname ?: "Music Together",
                    summary = "按类别管理应用与播放器设置",
                )
            }
            item {
                MiuixSettingsGroup {
                    categories.forEach { category ->
                        val onHapticOpen = rememberHapticClick { onOpen(category.destination) }
                        ArrowPreference(
                            title = category.title,
                            summary = category.summary,
                            startAction = {
                                MiuixIcon(
                                    imageVector = category.icon,
                                    contentDescription = null,
                                    tint = MiuixTheme.colorScheme.primary,
                                )
                            },
                            onClick = onHapticOpen,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsHero(title: String, summary: String) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Column(Modifier.padding(horizontal = 8.dp, vertical = 12.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        UiStyle.Miuix -> Column(Modifier.padding(horizontal = 8.dp, vertical = 18.dp)) {
            MiuixText(title, style = MiuixTheme.textStyles.title1, fontWeight = FontWeight.Bold)
            MiuixText(summary, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
        }
    }
}

@Composable
private fun SettingsCategoryCard(category: SettingsCategory, onClick: () -> Unit) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(
            onClick = onClick,
            shape = RoundedCornerShape(22.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        ) {
            ListItem(
                headlineContent = { Text(category.title, fontWeight = FontWeight.SemiBold) },
                supportingContent = { Text(category.summary) },
                leadingContent = { Icon(category.icon, null, tint = MaterialTheme.colorScheme.primary) },
                trailingContent = { Icon(Icons.AutoMirrored.Filled.ArrowForward, null) },
            )
        }
        UiStyle.Miuix -> MiuixCard(
            modifier = Modifier.fillMaxWidth(),
        ) {
            ArrowPreference(
                title = category.title,
                summary = category.summary,
                startAction = {
                    MiuixIcon(category.icon, null, tint = MiuixTheme.colorScheme.primary)
                },
                onClick = onClick,
            )
        }
    }
}

@Composable
private fun SettingsPage(
    title: String,
    onBack: () -> Unit,
    content: @Composable () -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(Modifier.weight(1f)) { content() }
        }

        UiStyle.Miuix -> MiuixScaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = LocalAppPageBackground.current,
            topBar = {
                MiuixSmallTopAppBar(
                    title = title,
                    color = LocalAppPageBackground.current,
                    navigationIcon = {
                        MiuixIconButton(onClick = onBack) {
                            MiuixIcon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                        }
                    },
                )
            },
            contentWindowInsets = WindowInsets.systemBars
                .add(WindowInsets.displayCutout)
                .only(WindowInsetsSides.Horizontal),
        ) { innerPadding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .consumeWindowInsets(innerPadding),
            ) { content() }
        }
    }
}

@Composable
private fun AppearanceSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixAppearanceSettingsPage(state, viewModel)
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            UiStyleSelector(state.uiStyle, viewModel::updateUiStyle)
        }
        item {
            ChoiceSetting(
                title = "主题模式",
                summary = "普通深色保留层次，纯黑仅在 AMOLED 模式启用",
                icon = Icons.Default.ColorLens,
                entries = ThemeMode.entries,
                selected = state.themeMode,
                label = ThemeMode::label,
                onSelected = viewModel::updateThemeMode,
            )
        }
        item {
            SettingsSwitch(
                title = "系统动态色",
                summary = "使用壁纸主色生成界面色板",
                icon = Icons.Default.Palette,
                checked = state.dynamicColor,
                onCheckedChange = viewModel::updateDynamicColor,
            )
        }
        if (state.uiStyle == UiStyle.Miuix) {
            item {
                ChoiceSetting(
                    title = "主页底栏",
                    summary = "标准底栏或类 iOS 悬浮胶囊",
                    icon = Icons.Default.Tune,
                    entries = BottomBarStyle.entries,
                    selected = state.bottomBarStyle,
                    label = BottomBarStyle::label,
                    onSelected = viewModel::updateBottomBarStyle,
                )
            }
            if (state.bottomBarStyle == BottomBarStyle.Floating) {
                item {
                    SettingsSwitch(
                        title = "液态玻璃",
                        summary = "支持时启用官方实时折射；不支持时保持官方实色 iOS 胶囊",
                        icon = Icons.Default.BlurOn,
                        checked = state.glassBottomBar,
                        onCheckedChange = viewModel::updateGlassBottomBar,
                    )
                }
            }
        }
    }
}

@Composable
private fun MiuixAppearanceSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { UiStyleSelector(state.uiStyle, viewModel::updateUiStyle) }
        item { SettingsSectionTitle("主题") }
        item {
            MiuixSettingsGroup {
                ChoiceSetting(
                    "主题模式",
                    "跟随系统、浅色或深色；纯黑背景可单独开启",
                    Icons.Default.ColorLens,
                    ThemeMode.entries.filterNot { it == ThemeMode.Amoled },
                    if (state.themeMode == ThemeMode.Amoled) ThemeMode.Dark else state.themeMode,
                    ThemeMode::label,
                    false,
                    viewModel::updateThemeMode,
                )
                SettingsSwitch("纯黑背景", "深色模式下将页面底层设为纯黑，卡片仍保留 MIUIX 层次", Icons.Default.ColorLens, state.pureBlackBackground, false, viewModel::updatePureBlackBackground)
                SettingsSwitch("系统动态色", "使用壁纸主色生成界面色板", Icons.Default.Palette, state.dynamicColor, false, viewModel::updateDynamicColor)
            }
        }
        item { SettingsSectionTitle("界面效果") }
        item {
            MiuixSettingsGroup {
                SettingsSwitch("界面模糊", "支持的设备上为悬浮组件提供背景采样", Icons.Default.BlurOn, state.appBlurEnabled, false, viewModel::updateAppBlur)
                ChoiceSetting("主页底栏", "标准底栏或类 iOS 悬浮胶囊", Icons.Default.Tune, BottomBarStyle.entries, state.bottomBarStyle, BottomBarStyle::label, false, viewModel::updateBottomBarStyle)
                if (state.bottomBarStyle == BottomBarStyle.Floating) {
                    SettingsSwitch("液态玻璃", "支持时启用官方实时折射；不支持时保持官方实色 iOS 胶囊", Icons.Default.BlurOn, state.glassBottomBar, false, viewModel::updateGlassBottomBar)
                }
            }
        }
    }
}

@Composable
private fun PlayerSettingsPage(settings: PlayerDisplaySettings, viewModel: MusicTogetherViewModel) {
    if (LocalUiStyle.current == UiStyle.Miuix) {
        MiuixPlayerSettingsPage(settings, viewModel)
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SettingsSectionTitle("辅助歌词") }
        item { SettingsSwitch("显示翻译", "显示主歌词下方的翻译", Icons.Default.Translate, settings.showTranslation) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(showTranslation = it) }
        } }
        item { SettingsSwitch("显示音译", "显示罗马音或逐词音译", Icons.Default.Translate, settings.showRomanization) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(showRomanization = it) }
        } }
        item { SettingsSectionTitle("排版") }
        item { SettingsSlider("歌词大小", "${(settings.lyricFontScale * 100).toInt()}%", Icons.Default.GraphicEq, settings.lyricFontScale, 0.8f..1.3f, 9) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricFontScale = it) }
        } }
        item { SettingsSlider("歌词字重", settings.lyricFontWeight.toString(), Icons.Default.GraphicEq, settings.lyricFontWeight.toFloat(), 400f..800f, 3) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricFontWeight = it.toInt()) }
        } }
        item { SettingsSlider("当前行位置", "${(settings.lyricAlignPosition * 100).toInt()}%", Icons.Default.Tune, settings.lyricAlignPosition, 0.05f..0.45f, 7) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricAlignPosition = it) }
        } }
        item { SettingsSectionTitle("动画与背景") }
        item { SettingsSwitch("弹簧动画", "使用 AMLL 风格的物理行切换", Icons.Default.Animation, settings.lyricSpringAnimation) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricSpringAnimation = it) }
        } }
        item { SettingsSwitch("当前行缩放", "突出当前播放的歌词行", Icons.Default.Animation, settings.lyricScaleEffect) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricScaleEffect = it) }
        } }
        item { SettingsSwitch("非当前行模糊", "更接近 AMLL，可能增加渲染负担", Icons.Default.BlurOn, settings.lyricBlurEffect) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(lyricBlurEffect = it) }
        } }
        item { SettingsSwitch("流体封面背景", "保持移动端全帧率的缓慢流体运动", Icons.Default.Animation, settings.backgroundMotion) {
            viewModel.updatePlayerDisplaySettings { current -> current.copy(backgroundMotion = it) }
        } }
        if (settings.backgroundMotion) {
            item { SettingsSlider("背景运动强度", "${(settings.backgroundMotionStrength * 100).toInt()}%", Icons.Default.Animation, settings.backgroundMotionStrength, 0.5f..1.5f, 9) {
                viewModel.updatePlayerDisplaySettings { current -> current.copy(backgroundMotionStrength = it) }
            } }
        }
    }
}

@Composable
private fun MiuixPlayerSettingsPage(settings: PlayerDisplaySettings, viewModel: MusicTogetherViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { SettingsSectionTitle("辅助歌词") }
        item {
            MiuixSettingsGroup {
                SettingsSwitch("显示翻译", "显示主歌词下方的翻译", Icons.Default.Translate, settings.showTranslation, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(showTranslation = value) } }
                SettingsSwitch("显示音译", "显示罗马音或逐词音译", Icons.Default.Translate, settings.showRomanization, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(showRomanization = value) } }
            }
        }
        item { SettingsSectionTitle("排版") }
        item {
            MiuixSettingsGroup {
                SettingsSlider("歌词大小", "${(settings.lyricFontScale * 100).toInt()}%", Icons.Default.GraphicEq, settings.lyricFontScale, 0.8f..1.3f, 9, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricFontScale = value) } }
                SettingsSlider("歌词字重", settings.lyricFontWeight.toString(), Icons.Default.GraphicEq, settings.lyricFontWeight.toFloat(), 400f..800f, 3, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricFontWeight = value.toInt()) } }
                SettingsSlider("当前行位置", "${(settings.lyricAlignPosition * 100).toInt()}%", Icons.Default.Tune, settings.lyricAlignPosition, 0.05f..0.45f, 7, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricAlignPosition = value) } }
            }
        }
        item { SettingsSectionTitle("动画与背景") }
        item {
            MiuixSettingsGroup {
                SettingsSwitch("弹簧动画", "使用 AMLL 风格的物理行切换", Icons.Default.Animation, settings.lyricSpringAnimation, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricSpringAnimation = value) } }
                SettingsSwitch("当前行缩放", "突出当前播放的歌词行", Icons.Default.Animation, settings.lyricScaleEffect, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricScaleEffect = value) } }
                SettingsSwitch("非当前行模糊", "更接近 AMLL，可能增加渲染负担", Icons.Default.BlurOn, settings.lyricBlurEffect, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(lyricBlurEffect = value) } }
                SettingsSwitch("流体封面背景", "保持移动端全帧率的缓慢流体运动", Icons.Default.Animation, settings.backgroundMotion, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(backgroundMotion = value) } }
                if (settings.backgroundMotion) {
                    SettingsSlider("背景运动强度", "${(settings.backgroundMotionStrength * 100).toInt()}%", Icons.Default.Animation, settings.backgroundMotionStrength, 0.5f..1.5f, 9, false) { value -> viewModel.updatePlayerDisplaySettings { it.copy(backgroundMotionStrength = value) } }
                }
            }
        }
    }
}

@Composable
private fun PlaybackSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    if (LocalUiStyle.current == UiStyle.Miuix) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
        ) {
            item {
                MiuixSettingsGroup {
                    SettingsSwitch("平滑变速同步", "小漂移使用保持音高的限幅变速", Icons.Default.SettingsEthernet, state.playbackTempoSyncEnabled, false, viewModel::updatePlaybackTempoSync)
                    SettingsSwitch("大漂移硬跳转", "连续确认明显漂移后执行 Seek", Icons.Default.SettingsEthernet, state.playbackHardSeekSyncEnabled, false, viewModel::updatePlaybackHardSeekSync)
                    SettingsSlider("同步包间隔", "${state.syncPacketIntervalSeconds} 秒", Icons.Default.SettingsEthernet, state.syncPacketIntervalSeconds.toFloat(), 1f..60f, 58, false) { viewModel.updateSyncPacketInterval(it.toInt()) }
                }
            }
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SettingsSwitch("平滑变速同步", "小漂移使用保持音高的限幅变速", Icons.Default.SettingsEthernet, state.playbackTempoSyncEnabled, onCheckedChange = viewModel::updatePlaybackTempoSync) }
        item { SettingsSwitch("大漂移硬跳转", "连续确认明显漂移后执行 Seek", Icons.Default.SettingsEthernet, state.playbackHardSeekSyncEnabled, onCheckedChange = viewModel::updatePlaybackHardSeekSync) }
        item { SettingsSlider("同步包间隔", "${state.syncPacketIntervalSeconds} 秒", Icons.Default.SettingsEthernet, state.syncPacketIntervalSeconds.toFloat(), 1f..60f, 58) {
            viewModel.updateSyncPacketInterval(it.toInt())
        } }
    }
}

@Composable
private fun GeneralSettingsPage(state: AppState, viewModel: MusicTogetherViewModel) {
    val onAudioMixingChanged = rememberHapticValueChange(viewModel::updateAllowAudioMixing)
    val onHapticFeedbackChanged = rememberHapticValueChange(viewModel::updateHapticFeedbackEnabled)
    if (LocalUiStyle.current == UiStyle.Miuix) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
        ) {
            item {
                MiuixSettingsGroup {
                    SettingsSwitch(
                        "允许与其他应用同时播放",
                        "开启后不再请求音频焦点，不主动暂停或压低其他媒体音量",
                        Icons.Default.PlayCircle,
                        state.allowAudioMixing,
                        false,
                        onAudioMixingChanged,
                    )
                    SettingsSwitch(
                        "触感反馈",
                        "点击按钮、导航项和可操作卡片时提供轻微震动",
                        Icons.Default.Vibration,
                        state.hapticFeedbackEnabled,
                        false,
                        onHapticFeedbackChanged,
                    )
                }
            }
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SettingsSwitch(
                "允许与其他应用同时播放",
                "开启后不再请求音频焦点，不主动暂停或压低其他媒体音量",
                Icons.Default.PlayCircle,
                state.allowAudioMixing,
                onCheckedChange = onAudioMixingChanged,
            )
        }
        item {
            SettingsSwitch(
                "触感反馈",
                "点击按钮、导航项和可操作卡片时提供轻微震动",
                Icons.Default.Vibration,
                state.hapticFeedbackEnabled,
                onCheckedChange = onHapticFeedbackChanged,
            )
        }
    }
}

@Composable
private fun SettingsSectionTitle(text: String) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp))
        UiStyle.Miuix -> MiuixText(text, style = MiuixTheme.textStyles.title3, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp))
    }
}

@Composable
private fun SettingsSwitch(
    title: String,
    summary: String,
    icon: ImageVector,
    checked: Boolean,
    wrapInCard: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            ListItem(
                headlineContent = { Text(title, fontWeight = FontWeight.SemiBold) },
                supportingContent = { Text(summary) },
                leadingContent = { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) },
                trailingContent = { Switch(checked, onCheckedChange) },
            )
        }
        UiStyle.Miuix -> {
            val preference: @Composable () -> Unit = {
                SwitchPreference(
                title = title,
                summary = summary,
                startAction = { MiuixIcon(icon, null, tint = MiuixTheme.colorScheme.onBackground) },
                checked = checked,
                onCheckedChange = onCheckedChange,
                )
            }
            if (wrapInCard) MiuixCard(modifier = Modifier.fillMaxWidth()) { preference() } else preference()
        }
    }
}

@Composable
private fun <T> ChoiceSetting(
    title: String,
    summary: String,
    icon: ImageVector,
    entries: List<T>,
    selected: T,
    label: (T) -> String,
    wrapInCard: Boolean = true,
    onSelected: (T) -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
                    Column { Text(title, fontWeight = FontWeight.SemiBold); Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    entries.forEachIndexed { index, entry ->
                        SegmentedButton(
                            selected = entry == selected,
                            onClick = { onSelected(entry) },
                            shape = SegmentedButtonDefaults.itemShape(index, entries.size),
                            label = { Text(label(entry)) },
                        )
                    }
                }
            }
        }
        UiStyle.Miuix -> {
            val preference: @Composable () -> Unit = {
                OverlayDropdownPreference(
                title = title,
                summary = summary,
                items = entries.map(label),
                startAction = { MiuixIcon(icon, null, tint = MiuixTheme.colorScheme.onBackground) },
                selectedIndex = entries.indexOf(selected).coerceAtLeast(0),
                onSelectedIndexChange = { index -> entries.getOrNull(index)?.let(onSelected) },
                )
            }
            if (wrapInCard) MiuixCard(modifier = Modifier.fillMaxWidth()) { preference() } else preference()
        }
    }
}

@Composable
private fun SettingsSlider(
    title: String,
    valueLabel: String,
    icon: ImageVector,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    wrapInCard: Boolean = true,
    onValueChange: (Float) -> Unit,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
                    Text(title, Modifier.padding(start = 10.dp).weight(1f), fontWeight = FontWeight.SemiBold)
                    Text(valueLabel, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Slider(value = value, onValueChange = onValueChange, valueRange = range, steps = steps)
            }
        }
        UiStyle.Miuix -> {
            val sliderContent: @Composable () -> Unit = {
            Column(Modifier.padding(vertical = 4.dp)) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    MiuixIcon(icon, null, tint = MiuixTheme.colorScheme.onBackground)
                    MiuixText(title, Modifier.padding(start = 10.dp).weight(1f), fontWeight = FontWeight.SemiBold)
                    MiuixText(valueLabel, color = MiuixTheme.colorScheme.onSurfaceVariantActions)
                }
                MiuixSlider(
                    value = value,
                    onValueChange = onValueChange,
                    valueRange = range,
                    steps = steps,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
            }
            }
            if (wrapInCard) MiuixCard(modifier = Modifier.fillMaxWidth()) { sliderContent() } else sliderContent()
        }
    }
}

@Composable
private fun MiuixSettingsGroup(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    MiuixCard(
        modifier = Modifier.fillMaxWidth(),
        content = content,
    )
}

private val ThemeMode.label: String
    get() = when (this) {
        ThemeMode.System -> "系统"
        ThemeMode.Light -> "浅色"
        ThemeMode.Dark -> "深色"
        ThemeMode.Amoled -> "AMOLED"
    }

private val BottomBarStyle.label: String
    get() = when (this) {
        BottomBarStyle.Standard -> "标准"
        BottomBarStyle.Floating -> "悬浮"
    }
