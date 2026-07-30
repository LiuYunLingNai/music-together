package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.structuralEqualityPolicy
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllInterlude
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.lyrics.amllLineSpringParameters
import io.github.yueby.musictogether.lyrics.buildAmllInterludes
import io.github.yueby.musictogether.lyrics.findActiveAmllInterlude
import io.github.yueby.musictogether.lyrics.prepareAmllLyricGroups
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricsState
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.delay
import java.util.Locale

private const val AmllCenteredAlignPosition = 0.35f
private const val AmllPortraitAlignPosition = 0.10f
private const val AmllTopFadeEnd = 0.10f
private const val AmllBottomFadeStart = 0.91f
private const val AmllMainFontScale = 0.9f
private const val AmllTranslationFontScale = 0.75f
private const val AmllRomanFontScale = 0.75f
private const val AmllBackgroundFontScale = 0.7f
private const val AmllInactiveScale = 0.97f
private const val AmllPositionDampingRatio = 0.83f
private const val AmllScaleDampingRatio = 0.88f
private const val AmllSpringStiffness = 100f


private sealed interface AmllListItem {
    val stableKey: String

    data class Line(
        val trackId: String?,
        val groupIndex: Int,
        val group: AmllLyricGroup,
    ) : AmllListItem {
        override val stableKey =
            "line:$trackId:${group.main.startTimeMs}:$groupIndex"
    }

    data class Interlude(
        val trackId: String?,
        val value: AmllInterlude,
    ) : AmllListItem {
        override val stableKey =
            "interlude:$trackId:${value.startTimeMs}:${value.anchorGroupIndex}"
    }
}

private data class AmllPreviewGeometry(
    val centerYInRootPx: Float,
    val group: AmllLyricGroup,
)

private suspend fun LazyListState.scrollFocusedItemToAdaptiveAnchor(
    index: Int,
    animate: Boolean,
    alignPosition: Float,
    alignToTop: Boolean,
    scrollMotion: Animatable<Float, AnimationVector1D>,
    stiffness: Float = AmllSpringStiffness,
    dampingRatio: Float = AmllPositionDampingRatio,
): Boolean {
    val layoutInfo = layoutInfo
    val focusedItem = layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }
        ?: return false
    val distance = amllFocusDistance(
        itemOffset = focusedItem.offset,
        itemSize = focusedItem.size,
        viewportHeight = layoutInfo.viewportSize.height,
        alignPosition = alignPosition,
        alignToTop = alignToTop,
    )
    if (abs(distance) < 0.5f) return true

    if (animate) {
        val startValue = scrollMotion.value
        var previousValue = startValue
        scrollMotion.animateTo(
            targetValue = startValue + distance,
            animationSpec = spring(
                dampingRatio = dampingRatio,
                stiffness = stiffness,
            ),
        ) {
            val frameDelta = value - previousValue
            if (abs(frameDelta) >= 0.01f) {
                this@scrollFocusedItemToAdaptiveAnchor.dispatchRawDelta(frameDelta)
            }
            previousValue = value
        }
    } else {
        val consumed = scrollBy(distance)
        scrollMotion.snapTo(scrollMotion.value + consumed)
    }
    return true
}

internal fun amllFocusDistance(
    itemOffset: Int,
    itemSize: Int,
    viewportHeight: Int,
    alignPosition: Float,
    alignToTop: Boolean,
): Float {
    val itemAnchor = itemOffset + if (alignToTop) 0f else itemSize / 2f
    val viewportAnchor = viewportHeight * alignPosition.coerceIn(0f, 1f)
    return itemAnchor - viewportAnchor
}

internal fun shouldResetAmllFocus(
    previousGroupIndex: Int,
    timelineDiscontinuity: Boolean,
): Boolean =
    previousGroupIndex < 0 ||
        timelineDiscontinuity

private fun formatLyricTimestamp(timeMs: Long): String {
    val totalSeconds = timeMs.coerceAtLeast(0L) / 1_000L
    return String.format(
        Locale.ROOT,
        "%d:%02d",
        totalSeconds / 60L,
        totalSeconds % 60L,
    )
}

internal fun amllBackgroundHeightContribution(
    backgroundHeight: Int,
    revealProgress: Float,
): Int = (backgroundHeight * revealProgress.coerceIn(0f, 1f)).roundToInt()

internal fun hasAmllLyricTimestampRoom(
    lyricWidthPx: Float,
    timestampWidthPx: Float,
    containerWidthPx: Float,
    gapPx: Float,
): Boolean =
    lyricWidthPx.coerceAtLeast(0f) * 1.12f +
        timestampWidthPx.coerceAtLeast(0f) +
        gapPx.coerceAtLeast(0f) <= containerWidthPx.coerceAtLeast(0f)

internal fun amllLineBlurRadiusDp(
    groupIndex: Int,
    focusedGroupIndex: Int,
    active: Boolean,
    userScrolling: Boolean,
): Float {
    if (active || userScrolling || focusedGroupIndex < 0) return 0f
    val distance = abs(groupIndex - focusedGroupIndex)
    if (distance == 0) return 0f
    return (0.35f + distance * 0.58f).coerceAtMost(2.7f)
}

internal fun amllSubLineHighlight(progress: Float): Float =
    1f - (1f - progress.coerceIn(0f, 1f)).pow(3)

@Composable
internal fun LyricsPanel(
    lyrics: LyricsState,
    positionSeconds: Double,
    lyricOffsetMs: Int = 0,
    isPlaying: Boolean,
    onSeek: ((Double) -> Unit)? = null,
    alignToTop: Boolean = false,
) {
    val rawPositionMs = (positionSeconds * 1_000.0 - lyricOffsetMs).toFloat().coerceAtLeast(0f)
    val groups = remember(lyrics.lines) { prepareAmllLyricGroups(lyrics.lines) }
    val playbackTimeline = rememberAmllPlaybackTimeline(
        groups = groups,
        rawPositionMs = rawPositionMs,
        isPlaying = isPlaying,
        resetKey = lyrics.trackId to lyricOffsetMs,
    )
    val timelineFrame by playbackTimeline.frame
    val smoothPositionMs = playbackTimeline.positionMs
    val isDynamic = lyrics.source in setOf("ttml", "wordByWord", "yrc")
    val activeGroupIndices = timelineFrame.bufferedGroupIndices
    val interludeSlots = remember(groups) { buildAmllInterludes(groups) }
    // Keep the waiting indicator lifecycle on the current playback time, as AMLL does.
    // The derived state only changes the active stable slot when the interval changes,
    // while sharing the same frame clock as the word masks and line focus.
    // It also prevents a delayed timeline-frame boundary from retaining an
    // expired indicator.
    val currentInterlude by remember(interludeSlots, smoothPositionMs) {
        derivedStateOf(structuralEqualityPolicy()) {
            findActiveAmllInterlude(
                interludes = interludeSlots,
                currentTimeMs = smoothPositionMs.value.toLong(),
            )
        }
    }
    val currentInterludeKey = currentInterlude?.let {
        "${it.startTimeMs}:${it.endTimeMs}:${it.anchorGroupIndex}"
    }
    var dismissedInterludeKey by remember(lyrics.trackId, groups) {
        mutableStateOf<String?>(null)
    }
    LaunchedEffect(currentInterludeKey, dismissedInterludeKey) {
        val dismissedKey = dismissedInterludeKey ?: return@LaunchedEffect
        if (currentInterludeKey != dismissedKey) {
            dismissedInterludeKey = null
        } else {
            // If the remote seek is rejected, restore the still-current
            // interlude instead of leaving the lyric layout permanently blank.
            delay(2_000)
            if (currentInterludeKey == dismissedInterludeKey) {
                dismissedInterludeKey = null
            }
        }
    }
    val interlude = currentInterlude.takeUnless {
        currentInterludeKey != null && currentInterludeKey == dismissedInterludeKey
    }
    val mainLyricCenterByGroup = remember(lyrics.trackId, groups) {
        mutableStateMapOf<Int, Float>()
    }
    val listItems = remember(lyrics.trackId, groups, interludeSlots) {
        val interludeByAnchor = interludeSlots.associateBy(AmllInterlude::anchorGroupIndex)
        buildList {
            groups.forEachIndexed { index, group ->
                interludeByAnchor[index - 1]?.let { interludeSlot ->
                    add(
                        AmllListItem.Interlude(
                            trackId = lyrics.trackId,
                            value = interludeSlot,
                        ),
                    )
                }
                add(
                    AmllListItem.Line(
                        trackId = lyrics.trackId,
                        groupIndex = index,
                        group = group,
                    ),
                )
            }
        }
    }
    val focusedGroupIndex = timelineFrame.focusedGroupIndex
    val focusedListIndex = listItems.indexOfFirst { item ->
        item is AmllListItem.Line && item.groupIndex == focusedGroupIndex
    }

    when {
        lyrics.loading -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }

        groups.isEmpty() -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = lyrics.error ?: "暂无歌词",
                color = Color.White.copy(alpha = 0.58f),
            )
        }

        else -> BoxWithConstraints(Modifier.fillMaxSize()) {
            val alignPosition =
                if (alignToTop) AmllPortraitAlignPosition else AmllCenteredAlignPosition
            val mainFontSize = (
                minOf(maxHeight.value * 0.05f, maxWidth.value * 0.07f) *
                    AmllMainFontScale
                ).coerceIn(16f, 80f)
            val translationFontSize = mainFontSize * AmllTranslationFontScale
            val romanFontSize = mainFontSize * AmllRomanFontScale
            val backgroundFontSize = mainFontSize * AmllBackgroundFontScale
            val density = LocalDensity.current
            val lineGap = with(density) { (mainFontSize * 0.4f).sp.toDp() }
            val edgePadding = maxOf(8.dp, lineGap)
            val firstLineInset =
                maxOf(edgePadding, maxHeight * AmllTopFadeEnd + lineGap)
            val lastLineInset =
                maxOf(edgePadding, maxHeight * (1f - AmllBottomFadeStart) + lineGap)
            val listState = remember(lyrics.trackId, groups) { LazyListState() }
            val scrollMotion = remember(listState) { Animatable(0f) }
            val isDragged by listState.interactionSource.collectIsDraggedAsState()
            var manualBrowseActive by remember(lyrics.trackId, groups) {
                mutableStateOf(false)
            }
            var previousFocusedGroupIndex by remember(lyrics.trackId, groups) {
                mutableIntStateOf(-1)
            }
            var handledSeekGeneration by remember(lyrics.trackId, groups) {
                mutableIntStateOf(timelineFrame.seekGeneration)
            }
            val previewGroupIndex by remember(
                listItems,
                listState,
                manualBrowseActive,
                alignPosition,
                alignToTop,
            ) {
                derivedStateOf {
                    if (!manualBrowseActive) {
                        -1
                    } else {
                        val layoutInfo = listState.layoutInfo
                        layoutInfo.visibleItemsInfo
                            .mapNotNull { visibleItem ->
                                val item =
                                    listItems.getOrNull(visibleItem.index) as? AmllListItem.Line
                                        ?: return@mapNotNull null
                                val distance = amllFocusDistance(
                                    itemOffset = visibleItem.offset,
                                    itemSize = visibleItem.size,
                                    viewportHeight = layoutInfo.viewportSize.height,
                                    alignPosition = alignPosition,
                                    alignToTop = alignToTop,
                                )
                                item.groupIndex to abs(distance)
                            }
                            .minByOrNull { (_, distance) -> distance }
                            ?.first
                            ?: -1
                    }
                }
            }
            val previewGeometry by remember(
                listItems,
                listState,
                previewGroupIndex,
            ) {
                derivedStateOf {
                    val visibleItem = listState.layoutInfo.visibleItemsInfo.firstOrNull { info ->
                        val item = listItems.getOrNull(info.index) as? AmllListItem.Line
                        item?.groupIndex == previewGroupIndex
                    }
                    val lineItem = visibleItem
                        ?.let { listItems.getOrNull(it.index) as? AmllListItem.Line }
                    if (visibleItem == null || lineItem == null) {
                        null
                    } else {
                        mainLyricCenterByGroup[lineItem.groupIndex]?.let { centerY ->
                            AmllPreviewGeometry(
                                centerYInRootPx = centerY,
                                group = lineItem.group,
                            )
                        }
                    }
                }
            }

            LaunchedEffect(isDragged, listState.isScrollInProgress) {
                when {
                    isDragged -> manualBrowseActive = true
                    manualBrowseActive && !listState.isScrollInProgress -> {
                        delay(5_000)
                        if (!isDragged && !listState.isScrollInProgress) {
                            manualBrowseActive = false
                        }
                    }
                }
            }

            LaunchedEffect(
                lyrics.trackId,
                groups,
                focusedListIndex,
                listItems.size,
                timelineFrame.seekGeneration,
                manualBrowseActive,
                alignPosition,
                alignToTop,
            ) {
                if (focusedListIndex >= 0 && !manualBrowseActive) {
                    val previousGroupIndex = previousFocusedGroupIndex
                    val focusChanged = focusedGroupIndex != previousGroupIndex
                    val timelineDiscontinuity =
                        timelineFrame.seekGeneration != handledSeekGeneration
                    handledSeekGeneration = timelineFrame.seekGeneration
                    val shouldReset = shouldResetAmllFocus(
                        previousGroupIndex = previousGroupIndex,
                        timelineDiscontinuity = timelineDiscontinuity,
                    )
                    // Record the new focus before any suspending animation.
                    // Rapid lyrics can replace this effect while the previous
                    // spring is still moving; deferring the assignment would
                    // misclassify the next adjacent line as a seek.
                    previousFocusedGroupIndex = focusedGroupIndex

                    if (shouldReset) {
                        listState.scrollToItem(
                            index = focusedListIndex,
                        )
                        withFrameNanos { }
                        listState.scrollFocusedItemToAdaptiveAnchor(
                            index = focusedListIndex,
                            animate = false,
                            alignPosition = alignPosition,
                            alignToTop = alignToTop,
                            scrollMotion = scrollMotion,
                        )
                    } else {
                        // Wait until insertion/removal of an interlude item is
                        // reflected before measuring the new focus position.
                        withFrameNanos { }
                        val springParameters = amllLineSpringParameters(
                            currentStartTimeMs = groups[focusedGroupIndex].startTimeMs,
                            previousStartTimeMs =
                                groups.getOrNull(focusedGroupIndex - 1)?.startTimeMs,
                            stabilize = interlude != null || !focusChanged,
                        )
                        val aligned = listState.scrollFocusedItemToAdaptiveAnchor(
                            index = focusedListIndex,
                            animate = true,
                            alignPosition = alignPosition,
                            alignToTop = alignToTop,
                            scrollMotion = scrollMotion,
                            stiffness = springParameters.stiffness,
                            dampingRatio = springParameters.dampingRatio,
                        )
                        if (!aligned) {
                            listState.animateScrollToItem(index = focusedListIndex)
                            withFrameNanos { }
                            listState.scrollFocusedItemToAdaptiveAnchor(
                                index = focusedListIndex,
                                animate = false,
                                alignPosition = alignPosition,
                                alignToTop = alignToTop,
                                scrollMotion = scrollMotion,
                            )
                        }
                    }
                }
            }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        compositingStrategy = CompositingStrategy.Offscreen
                    }
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            brush = Brush.verticalGradient(
                                0f to Color.Transparent,
                                AmllTopFadeEnd to Color.Black,
                                AmllBottomFadeStart to Color.Black,
                                1f to Color.Transparent,
                            ),
                            blendMode = BlendMode.DstIn,
                        )
                    },
                state = listState,
                contentPadding = PaddingValues(
                    start = 20.dp,
                    top = firstLineInset,
                    end = 20.dp,
                    bottom = lastLineInset,
                ),
                verticalArrangement = Arrangement.spacedBy(lineGap),
            ) {
                itemsIndexed(
                    items = listItems,
                    key = { _, item -> item.stableKey },
                ) { _, item ->
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        when (item) {
                            is AmllListItem.Line -> AmllLineGroup(
                                group = item.group,
                                positionMs = smoothPositionMs,
                                active = item.groupIndex in activeGroupIndices && interlude == null,
                                previewed =
                                    manualBrowseActive &&
                                        item.groupIndex == previewGroupIndex,
                                isPlaying = isPlaying,
                                isDynamic = isDynamic,
                                groupIndex = item.groupIndex,
                                focusedGroupIndex = focusedGroupIndex,
                                userScrolling = manualBrowseActive,
                                onClick = onSeek?.let { seek ->
                                    {
                                        dismissedInterludeKey = currentInterludeKey
                                        manualBrowseActive = false
                                        seek(item.group.main.startTimeMs / 1_000.0)
                                    }
                                },
                                onMainLyricCenterInRootChanged = { centerY ->
                                    val previous = mainLyricCenterByGroup[item.groupIndex]
                                    if (previous == null || abs(previous - centerY) >= 0.5f) {
                                        mainLyricCenterByGroup[item.groupIndex] = centerY
                                    }
                                },
                                mainFontSize = mainFontSize,
                                translationFontSize = translationFontSize,
                                romanFontSize = romanFontSize,
                                backgroundFontSize = backgroundFontSize,
                            )

                            is AmllListItem.Interlude -> AmllInterludeSlot(
                                interlude = item.value,
                                positionMs = smoothPositionMs,
                                active = item.value == interlude,
                                fontSize = mainFontSize,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }

            AmllTimestampPreview(
                geometry = previewGeometry,
                visible = manualBrowseActive,
                containerWidth = maxWidth,
                mainFontSize = mainFontSize,
                translationFontSize = translationFontSize,
                romanFontSize = romanFontSize,
                backgroundFontSize = backgroundFontSize,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun AmllLineGroup(
    group: AmllLyricGroup,
    positionMs: State<Float>,
    active: Boolean,
    previewed: Boolean,
    isPlaying: Boolean,
    isDynamic: Boolean,
    groupIndex: Int,
    focusedGroupIndex: Int,
    userScrolling: Boolean,
    onClick: (() -> Unit)?,
    onMainLyricCenterInRootChanged: (Float) -> Unit,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
    backgroundFontSize: Float,
) {
    val line = group.main
    var retainedPositionMs by remember(line) {
        mutableFloatStateOf(line.startTimeMs.toFloat())
    }
    val livePositionMs = if (active) positionMs.value else null
    SideEffect {
        livePositionMs?.let { retainedPositionMs = it }
    }
    val currentPositionMs = livePositionMs ?: retainedPositionMs
    val effectReleaseProgress by animateFloatAsState(
        targetValue = if (active) 1f else 0f,
        animationSpec = tween(durationMillis = if (active) 70 else 300),
        label = "amllEffectRelease",
    )
    val scale by animateFloatAsState(
        targetValue = when {
            !isPlaying || active -> 1f
            previewed -> 0.992f
            else -> AmllInactiveScale
        },
        animationSpec = spring(
            dampingRatio = AmllScaleDampingRatio,
            stiffness = AmllSpringStiffness,
        ),
        label = "amllLineScale",
    )
    val background = group.background
    val backgroundFirst =
        background?.words?.firstOrNull()?.startTimeMs
            ?.let { backgroundStart ->
                backgroundStart < (line.words.firstOrNull()?.startTimeMs ?: line.startTimeMs)
            }
            ?: false
    val backgroundRevealed = background != null && (active || !isPlaying)
    val backgroundRevealProgress by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0f,
        animationSpec = spring(
            dampingRatio = 1f,
            stiffness = AmllSpringStiffness,
        ),
        label = "amllBackgroundReveal",
    )
    val blurRadius by animateFloatAsState(
        targetValue = amllLineBlurRadiusDp(
            groupIndex = groupIndex,
            focusedGroupIndex = focusedGroupIndex,
            active = active,
            userScrolling = userScrolling,
        ),
        animationSpec = tween(durationMillis = 400),
        label = "amllLineBlur",
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .blur(
                radius = blurRadius.dp,
                edgeTreatment = BlurredEdgeTreatment.Unbounded,
            )
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onClick,
                    )
                } else {
                    Modifier
                },
            ),
    ) {
        AmllMainAndBackgroundLayout(
            backgroundFirst = backgroundFirst,
            backgroundRevealProgress = backgroundRevealProgress,
            main = {
                AmllMainLine(
                    line = line,
                    positionMs = currentPositionMs,
                    active = active,
                    effectReleaseProgress = effectReleaseProgress,
                    onPrimaryTextCenterInRootChanged = onMainLyricCenterInRootChanged,
                    previewed = previewed,
                    isPlaying = isPlaying,
                    isDynamic = isDynamic,
                    lineScale = scale,
                    mainFontSize = mainFontSize,
                    translationFontSize = translationFontSize,
                    romanFontSize = romanFontSize,
                )
            },
            background = background?.let { backgroundLine ->
                @Composable {
                    AmllBackgroundLine(
                        line = backgroundLine,
                        positionMs = currentPositionMs,
                        visible = active,
                        effectReleaseProgress = effectReleaseProgress,
                        revealProgress = backgroundRevealProgress,
                        placeBeforeMain = backgroundFirst,
                        fontSize = backgroundFontSize,
                        isDynamic = isDynamic,
                    )
                }
            },
        )

    }
}

@Composable
private fun AmllTimestampPreview(
    geometry: AmllPreviewGeometry?,
    visible: Boolean,
    containerWidth: androidx.compose.ui.unit.Dp,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
    backgroundFontSize: Float,
    modifier: Modifier = Modifier,
) {
    var containerTopInRootPx by remember { mutableFloatStateOf(0f) }
    val group = geometry?.group
    val line = group?.main
    val timestampText = line?.let {
        formatLyricTimestamp(it.words.firstOrNull()?.startTimeMs ?: it.startTimeMs)
    }.orEmpty()
    val timestampFontSize = (mainFontSize * 0.42f).coerceAtLeast(10f)
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val hasRoom = remember(
        line,
        group?.background,
        timestampText,
        mainFontSize,
        translationFontSize,
        romanFontSize,
        backgroundFontSize,
        timestampFontSize,
        containerWidth,
        density,
    ) {
        fun measureWidth(text: String, style: TextStyle): Float {
            if (text.isBlank()) return 0f
            return textMeasurer.measure(
                text = text,
                style = style,
                softWrap = false,
                maxLines = 1,
            ).size.width.toFloat()
        }

        val lyricWidth = maxOf(
            measureWidth(
                line?.text.orEmpty(),
                TextStyle(
                    fontSize = mainFontSize.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            ),
            measureWidth(
                line?.translatedLyric.orEmpty(),
                TextStyle(fontSize = translationFontSize.sp),
            ),
            measureWidth(
                line?.romanLyric.orEmpty(),
                TextStyle(fontSize = romanFontSize.sp),
            ),
            measureWidth(
                group?.background?.text.orEmpty(),
                TextStyle(
                    fontSize = backgroundFontSize.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            ),
        )
        val timestampWidth = measureWidth(
            timestampText,
            TextStyle(
                fontSize = timestampFontSize.sp,
                fontWeight = FontWeight.Medium,
            ),
        )
        hasAmllLyricTimestampRoom(
            lyricWidthPx = lyricWidth,
            timestampWidthPx = timestampWidth,
            containerWidthPx = with(density) { containerWidth.toPx() },
            gapPx = with(density) { 12.dp.toPx() },
        )
    }

    Box(
        modifier.onGloballyPositioned { coordinates ->
            containerTopInRootPx = coordinates.positionInRoot().y
        },
    ) {
        AnimatedVisibility(
            visible = visible && geometry != null && hasRoom,
            modifier = Modifier
                .align(
                    if (line?.isDuet == true) Alignment.TopStart else Alignment.TopEnd,
                )
                .graphicsLayer {
                    translationY =
                        (geometry?.centerYInRootPx ?: 0f) -
                        containerTopInRootPx -
                        size.height / 2f
                },
            enter = fadeIn(tween(140)),
            exit = fadeOut(tween(180)),
        ) {
            Text(
                text = timestampText,
                color = Color.White.copy(alpha = 0.38f),
                fontSize = timestampFontSize.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}

/**
 * AMLL positions an inactive background vocal outside the main flow, then
 * progressively restores its measured height while the group becomes active.
 */
@Composable
private fun AmllMainAndBackgroundLayout(
    backgroundFirst: Boolean,
    backgroundRevealProgress: Float,
    main: @Composable () -> Unit,
    background: (@Composable () -> Unit)?,
) {
    Layout(
        modifier = Modifier.fillMaxWidth(),
        content = {
            main()
            background?.invoke()
        },
    ) { measurables, constraints ->
        val mainPlaceable = measurables.first().measure(constraints)
        val backgroundPlaceable = measurables.getOrNull(1)?.measure(
            constraints.copy(minHeight = 0),
        )
        val backgroundContribution = amllBackgroundHeightContribution(
            backgroundHeight = backgroundPlaceable?.height ?: 0,
            revealProgress = backgroundRevealProgress,
        )
        layout(
            width = mainPlaceable.width,
            height = mainPlaceable.height + backgroundContribution,
        ) {
            mainPlaceable.placeRelative(
                x = 0,
                y = if (backgroundFirst) backgroundContribution else 0,
            )
            backgroundPlaceable?.placeRelative(
                x = 0,
                y = if (backgroundFirst) {
                    backgroundContribution - backgroundPlaceable.height
                } else {
                    mainPlaceable.height
                },
            )
        }
    }
}

@Composable
private fun AmllMainLine(
    line: LyricLine,
    positionMs: Float,
    active: Boolean,
    effectReleaseProgress: Float,
    onPrimaryTextCenterInRootChanged: (Float) -> Unit,
    previewed: Boolean,
    isPlaying: Boolean,
    isDynamic: Boolean,
    lineScale: Float,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
) {
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val firstWordStart = line.words.firstOrNull()?.startTimeMs ?: line.startTimeMs
    val lastWordEnd = line.words.lastOrNull()?.endTimeMs ?: line.endTimeMs
    val lineProgress = when {
        !active || positionMs <= firstWordStart -> 0f
        positionMs >= lastWordEnd -> 1f
        else -> (
            (positionMs - firstWordStart) /
                (lastWordEnd - firstWordStart).coerceAtLeast(1L)
            ).coerceIn(0f, 1f)
    }
    val subLineTargetAlpha = when {
        active && positionMs >= firstWordStart ->
            0.38f + amllSubLineHighlight(lineProgress) * 0.30f
        previewed -> 0.46f
        else -> 0.30f
    }
    val subLineAlpha = rememberAmllMaskAlpha(subLineTargetAlpha).value
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = lineScale
                scaleY = lineScale
                transformOrigin =
                    if (line.isDuet) TransformOrigin(1f, 0.5f) else TransformOrigin(0f, 0.5f)
            },
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        AmllWordLine(
            line = line,
            positionMs = positionMs,
            active = active,
            effectReleaseProgress = effectReleaseProgress,
            onPrimaryTextCenterInRootChanged = onPrimaryTextCenterInRootChanged,
            previewed = previewed,
            isPlaying = isPlaying,
            isDynamic = isDynamic,
            lineScale = lineScale,
            fontSize = mainFontSize,
            fontWeight = FontWeight.SemiBold,
        )
        line.translatedLyric.takeIf(String::isNotBlank)?.let { translated ->
            Text(
                text = translated,
                modifier = Modifier.fillMaxWidth(),
                textAlign = textAlign,
                fontSize = translationFontSize.sp,
                lineHeight = (translationFontSize * 1.5f).sp,
                color = Color.White.copy(alpha = subLineAlpha),
            )
        }
        line.romanLyric
            .takeIf {
                it.isNotBlank() && line.words.none { word -> word.romanText.isNotBlank() }
            }
            ?.let { roman ->
                Text(
                    text = roman,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = textAlign,
                    fontSize = romanFontSize.sp,
                    lineHeight = (romanFontSize * 1.5f).sp,
                    color = Color.White.copy(alpha = subLineAlpha),
                )
            }
    }
}

@Composable
private fun AmllBackgroundLine(
    line: LyricLine,
    positionMs: Float,
    visible: Boolean,
    effectReleaseProgress: Float,
    revealProgress: Float,
    placeBeforeMain: Boolean,
    fontSize: Float,
    isDynamic: Boolean,
) {
    val wrapperScale = 0.8f + revealProgress * 0.2f
    val lineScale = 0.75f + revealProgress * 0.25f
    val backgroundTransformOrigin =
        if (line.isDuet) {
            TransformOrigin(1f, if (placeBeforeMain) 1f else 0f)
        } else {
            TransformOrigin(0f, if (placeBeforeMain) 1f else 0f)
        }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                alpha = revealProgress * 0.4f
                scaleX = wrapperScale
                scaleY = wrapperScale
                translationY =
                    (if (placeBeforeMain) 1f else -1f) *
                    (1f - revealProgress) *
                    size.height *
                    0.8f
                transformOrigin = backgroundTransformOrigin
            },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    scaleX = lineScale
                    scaleY = lineScale
                    transformOrigin = backgroundTransformOrigin
                },
        ) {
            AmllWordLine(
                line = line,
                positionMs = positionMs,
                active = visible &&
                    positionMs >= (
                        line.words.minOfOrNull { it.startTimeMs } ?: line.startTimeMs
                        ) &&
                    positionMs < (
                        line.words.maxOfOrNull { it.endTimeMs } ?: line.endTimeMs
                        ),
                effectReleaseProgress = effectReleaseProgress,
                isPlaying = true,
                isDynamic = isDynamic,
                lineScale = lineScale,
                fontSize = fontSize,
                fontWeight = FontWeight.SemiBold,
                isBackground = true,
            )
        }
    }
}

@Composable
private fun AmllInterludeSlot(
    interlude: AmllInterlude,
    positionMs: State<Float>,
    active: Boolean,
    fontSize: Float,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = active,
        modifier = modifier,
        enter = fadeIn(tween(250)) +
            expandVertically(
                animationSpec = tween(250),
                expandFrom = Alignment.Top,
                clip = false,
            ),
        exit = fadeOut(tween(250)) +
            shrinkVertically(
                animationSpec = tween(250),
                shrinkTowards = Alignment.Top,
                clip = false,
            ),
    ) {
        AmllInterludeDots(
            interlude = interlude,
            positionMs = positionMs,
            fontSize = fontSize,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun AmllInterludeDots(
    interlude: AmllInterlude,
    positionMs: State<Float>,
    fontSize: Float,
    modifier: Modifier = Modifier,
) {
    val currentPositionMs = positionMs.value
    val duration = (interlude.endTimeMs - interlude.startTimeMs).coerceAtLeast(1L).toFloat()
    val elapsed = (currentPositionMs - interlude.startTimeMs).coerceIn(0f, duration)
    val remaining = (duration - elapsed).coerceAtLeast(0f)
    val dotTimeline = (duration - 750f).coerceAtLeast(1f)
    val fadeInProgress = ((elapsed - 500f) / 500f).coerceIn(0f, 1f)
    val fadeOutProgress = (remaining / 375f).coerceIn(0f, 1f)
    val globalAlpha = minOf(fadeInProgress, fadeOutProgress)
    val breatheDuration = duration / ceil(duration / 1_500f).coerceAtLeast(1f)
    val breathe =
        1f + sin(1.5f * PI.toFloat() - (elapsed / breatheDuration) * 2f) / 20f
    val enterScale = if (elapsed < 2_000f) {
        1f - 2f.pow(-10f * (elapsed / 2_000f).coerceIn(0f, 1f))
    } else {
        1f
    }
    val exitScale = if (remaining < 750f) {
        1f - amllEaseInOutBack(
            ((750f - remaining) / 750f / 2f).coerceIn(0f, 0.5f),
        )
    } else {
        1f
    }
    val scale = (breathe * enterScale * exitScale * 0.7f).coerceAtLeast(0f)
    val dotAlphas = List(3) { index ->
        val offset = dotTimeline / 3f * index
        (((elapsed - offset) * 3f / dotTimeline) * 0.75f)
            .coerceIn(0.25f, 1f) * globalAlpha
    }
    val density = LocalDensity.current
    val dotSize = with(density) { (fontSize * 0.62f).sp.toDp() }
    val dotGap = with(density) { (fontSize * 0.25f).sp.toDp() }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(dotSize),
        contentAlignment =
            if (interlude.isNextDuet) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier
                .widthIn(min = dotSize * 3 + dotGap * 2)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                },
            horizontalArrangement = Arrangement.spacedBy(dotGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(3) { index ->
                Box(
                    modifier = Modifier
                        .size(dotSize)
                        .graphicsLayer { shape = CircleShape }
                        .drawWithContent {
                            drawCircle(Color.White.copy(alpha = dotAlphas[index]))
                        },
                )
            }
        }
    }
}

private fun amllEaseInOutBack(value: Float): Float {
    val x = value.coerceIn(0f, 1f)
    val c1 = 1.70158f
    val c2 = c1 * 1.525f
    return if (x < 0.5f) {
        ((2f * x).pow(2) * ((c2 + 1f) * 2f * x - c2)) / 2f
    } else {
        ((2f * x - 2f).pow(2) * ((c2 + 1f) * (2f * x - 2f) + c2) + 2f) / 2f
    }
}
