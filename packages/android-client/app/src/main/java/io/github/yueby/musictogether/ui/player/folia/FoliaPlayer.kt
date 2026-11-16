package io.github.yueby.musictogether.ui.player.folia

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.Minimize
import com.composables.icons.lucide.Palette
import com.composables.icons.lucide.SlidersHorizontal
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.lyrics.lyricOffsetKey
import io.github.yueby.musictogether.lyrics.prepareAmllLyricGroups
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.player.AudioSpectrum
import io.github.yueby.musictogether.ui.player.AnimatedPlayerVotePrompt
import io.github.yueby.musictogether.ui.player.IconButton
import io.github.yueby.musictogether.ui.player.MobilePlayerControls
import io.github.yueby.musictogether.ui.player.PlayerChatButton
import io.github.yueby.musictogether.ui.player.rememberAmllMotionPolicy
import io.github.yueby.musictogether.ui.player.rememberAmllPlaybackTimeline
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import org.json.JSONArray
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text

// The stage is primary, track metadata is secondary, controls are revealed on
// interaction. Controls retain the player's 48dp targets and 24dp gutters.
@Composable
internal fun FoliaPlayer(
    appState: AppState,
    viewModel: MusicTogetherViewModel,
    visible: Boolean,
    onExit: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val room = appState.room ?: return
    val player by viewModel.playerState.collectAsStateWithLifecycle()
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val active = visible && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    val track = player.track ?: room.currentTrack
    val offset = lyricOffsetKey(track)?.let(appState.lyricOffsets::get) ?: 0
    val lyrics = appState.lyrics.takeIf { it.trackId == track?.id }
    val groups = remember(lyrics?.lines) {
        prepareAmllLyricGroups(lyrics?.lines.orEmpty(), tryAdvanceStartTime = false)
    }
    val lines = remember(groups) { groups.map { it.main } }
    val policy = rememberAmllMotionPolicy()
    val timeline = rememberAmllPlaybackTimeline(
        groups = groups,
        rawPositionMs = foliaLyricPositionMs(player.positionSeconds, offset),
        isPlaying = player.playing && active,
        resetKey = track?.id to offset,
        minimumFrameIntervalNanos = policy.minimumFrameIntervalNanos,
    )
    var modeId by rememberSaveable(appState.serverUrl, room.id) { mutableStateOf("sonnet") }
    val mode = FoliaStageMode.entries.firstOrNull { it.id == modeId } ?: FoliaStageMode.Sonnet
    var chromeVisible by remember { mutableStateOf(true) }
    var pickerVisible by remember { mutableStateOf(false) }
    var settingsVisible by remember { mutableStateOf(false) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var returningFromFilePicker by remember { mutableStateOf(false) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(foliaChosenFiles(result.resultCode, result.data))
        fileCallback = null
    }
    DisposableEffect(Unit) {
        onDispose { fileCallback?.onReceiveValue(null); fileCallback = null }
    }
    LaunchedEffect(active, fileCallback) {
        if (active && fileCallback == null) returningFromFilePicker = false
    }
    var interaction by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<FoliaWebView?>(null) }
    var ready by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val document = remember(track, appState.lyrics, appState.playerDisplaySettings) {
        foliaDocument(track, appState.lyrics, appState.playerDisplaySettings, preserveAlternateText = true).toString()
    }
    val latestPlayer by rememberUpdatedState(player)
    val latestChrome by rememberUpdatedState(chromeVisible || pickerVisible || settingsVisible)
    val latestMode by rememberUpdatedState(mode)
    val latestLines by rememberUpdatedState(lines)
    val latestOffset by rememberUpdatedState(offset)
    val latestStatic by rememberUpdatedState(!policy.expensiveEffectsEnabled || !appState.playerDisplaySettings.backgroundMotion)

    fun reveal() {
        chromeVisible = true
        interaction++
    }
    BackHandler(enabled = visible && pickerVisible) { pickerVisible = false; reveal() }
    BackHandler(enabled = visible && settingsVisible) { settingsVisible = false; webView?.showSettings(false); reveal() }
    LaunchedEffect(chromeVisible, pickerVisible, settingsVisible, interaction, active, error) {
        if (chromeVisible && !pickerVisible && !settingsVisible && active && error == null) {
            delay(4_500)
            chromeVisible = false
        }
    }
    LaunchedEffect(modeId) { error = null; webView?.selectMode(mode.id) }
    DisposableEffect(active, mode) {
        val analyze = active && mode != FoliaStageMode.Still && mode != FoliaStageMode.Blank
        if (analyze) AudioSpectrum.acquire()
        onDispose { if (analyze) AudioSpectrum.release() }
    }
    LaunchedEffect(webView, ready, active, policy, timeline) {
        val stage = webView ?: return@LaunchedEffect
        if (!active || !ready) return@LaunchedEffect
        var previousFrame = 0L
        var previousPayload: String? = null
        while (isActive) {
            withFrameNanos { now ->
                // The one native lyric clock feeds line selection and word progress.
                val interval = if (latestMode == FoliaStageMode.Still || latestMode == FoliaStageMode.Blank) {
                    200_000_000L
                } else maxOf(policy.minimumFrameIntervalNanos, 33_000_000L)
                if (now - previousFrame < interval) return@withFrameNanos
                previousFrame = now
                val position = timeline.positionMs.value
                val bins = if (latestPlayer.playing) AudioSpectrum.latest else FloatArray(0)
                val frame = JSONObject().apply {
                    put("position", position / 1_000.0)
                    put("playbackPosition", latestPlayer.positionSeconds)
                    put("lineIndex", foliaLineIndex(latestLines, position))
                    put("paused", !latestPlayer.playing)
                    put("chromeHidden", !latestChrome)
                    put("staticMode", latestStatic || latestMode == FoliaStageMode.Still)
                    put("power", if (bins.isEmpty()) 0.0 else bins.average())
                    val bands = listOf("bass", "lowMid", "mid", "vocal", "treble")
                    bands.forEachIndexed { index, band ->
                        val from = index * bins.size / bands.size
                        val to = (index + 1) * bins.size / bands.size
                        var sum = 0f
                        for (bin in from until to) sum += bins[bin]
                        put(band, if (to > from) sum / (to - from) else 0f)
                    }
                    put("spectrum", JSONArray().apply { bins.forEach { put(it.toInt().coerceIn(0, 255)) } })
                }
                val payload = frame.toString()
                if (payload != previousPayload) {
                    previousPayload = payload
                    stage.updateFrame(payload)
                }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF080A0F))) {
        // Destroy covered/backgrounded renderers, workers and WebGL contexts.
        // A system document picker covers this Activity. Retain the requesting
        // WebView until its result arrives, while the frame/FFT jobs stay paused.
        if (active || (visible && returningFromFilePicker)) {
            AndroidView(
                factory = { context ->
                    FoliaWebView(context, onChooseFiles = { params, callback ->
                        fileCallback?.onReceiveValue(null)
                        fileCallback = callback
                        returningFromFilePicker = true
                        runCatching { filePicker.launch(foliaFileChooserIntent(params)) }.onFailure {
                            fileCallback?.onReceiveValue(null)
                            fileCallback = null
                            returningFromFilePicker = false
                        }
                    }) { event, position ->
                        when (event) {
                            "ready" -> { ready = true; error = null }
                            "seek" -> {
                                if (viewModel.canControl() && position != null && latestLines.any { kotlin.math.abs(it.startTimeMs / 1_000.0 - position) < 0.001 }) {
                                    viewModel.seek((position + latestOffset / 1_000.0).coerceAtLeast(0.0))
                                }
                            }
                            "editorSeek" -> {
                                if (viewModel.canControl() && position != null) {
                                    viewModel.seek((position + latestOffset / 1_000.0).coerceIn(0.0, latestPlayer.durationSeconds.coerceAtLeast(0.0)))
                                }
                            }
                            "play" -> if (!latestPlayer.playing) viewModel.togglePlayback()
                            "pause" -> if (latestPlayer.playing) viewModel.togglePlayback()
                            "settingsOpen" -> { settingsVisible = true; reveal() }
                            "settingsClose" -> { settingsVisible = false; reveal() }
                            "tap" -> { chromeVisible = !chromeVisible; interaction++ }
                            "error" -> { error = "舞台渲染失败，请尝试其他舞台"; reveal() }
                            "unsupported" -> { error = "请更新 Android System WebView 后使用沉浸舞台"; reveal() }
                        }
                    }.also { webView = it }
                },
                update = { stage -> stage.updateDocument(document); stage.selectMode(mode.id) },
                onRelease = { stage ->
                    fileCallback?.onReceiveValue(null); fileCallback = null
                    stage.release(); webView = null; ready = false; settingsVisible = false
                },
                modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.displayCutout),
            )
        }
        if (!ready || error != null || track == null || lyrics?.loading == true || (mode != FoliaStageMode.Blank && lyrics?.lines.isNullOrEmpty())) {
            Text(
                text = error ?: when {
                    !ready -> "舞台加载中…"
                    track == null -> "等待播放 · 点按屏幕唤出控制栏"
                    lyrics?.loading == true -> "歌词加载中…"
                    else -> "暂无歌词 · 点按屏幕唤出控制栏"
                },
                modifier = Modifier.align(Alignment.Center).clickable { reveal() }.padding(32.dp),
                color = Color.White,
                fontSize = 16.sp,
            )
        }
        AnimatedVisibility(
            visible = chromeVisible && visible && !settingsVisible,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn(), exit = fadeOut(),
        ) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent)))
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top))
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onExit, modifier = Modifier.size(48.dp)) {
                    Icon(Lucide.Minimize, "退出沉浸模式", Modifier.size(24.dp), tint = Color.White)
                }
                Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                    Text(track?.title ?: room.name, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 16.sp)
                    Text("Folia · " + mode.label, color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
                }
                PlayerChatButton(appState.chatUnreadCount, onOpenChat)
                IconButton(onClick = { webView?.showSettings(true); settingsVisible = true; reveal() }, modifier = Modifier.size(48.dp)) {
                    Icon(Lucide.SlidersHorizontal, "舞台配置", Modifier.size(24.dp), tint = Color.White)
                }
                IconButton(onClick = { pickerVisible = true; reveal() }, modifier = Modifier.size(48.dp)) {
                    Icon(Lucide.Palette, "选择舞台", Modifier.size(24.dp), tint = Color.White)
                }
            }
        }
        AnimatedVisibility(
            visible = chromeVisible && visible && !settingsVisible,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = fadeIn(), exit = fadeOut(),
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                if (event.changes.any { it.pressed || it.previousPressed }) reveal()
                            }
                        }
                    }
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                AnimatedPlayerVotePrompt(appState.activeVote, appState.userId, viewModel::castVote)
                MobilePlayerControls(track, room, player, viewModel, onOpenQueue, modifier = Modifier.widthIn(max = 560.dp))
            }
        }
        if (pickerVisible) {
            FoliaStagePicker(
                selected = mode,
                onSelect = { modeId = it.id; pickerVisible = false; reveal() },
                onDismiss = { pickerVisible = false; reveal() },
            )
        }
    }
}
