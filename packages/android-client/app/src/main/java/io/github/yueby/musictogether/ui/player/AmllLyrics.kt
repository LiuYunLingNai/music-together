package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.structuralEqualityPolicy
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllInterlude
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.lyrics.amllLineSpringParameters
import io.github.yueby.musictogether.lyrics.buildAmllInterludes
import io.github.yueby.musictogether.lyrics.findActiveAmllInterlude
import io.github.yueby.musictogether.lyrics.prepareAmllLyricGroups
import io.github.yueby.musictogether.model.LyricsState
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import java.util.Locale

internal const val AmllCenteredAlignPosition = 0.35f
internal const val AmllPortraitAlignPosition = 0.10f
internal const val AmllTopFadeEnd = 0.10f
internal const val AmllBottomFadeStart = 0.91f
internal const val AmllMainFontScale = 0.9f
internal const val AmllTranslationFontScale = 0.75f
internal const val AmllRomanFontScale = 0.75f
internal const val AmllBackgroundFontScale = 0.7f
internal const val AmllInactiveScale = 0.97f
internal const val AmllPositionDampingRatio = 0.83f
internal const val AmllScaleDampingRatio = 0.88f
internal const val AmllSpringStiffness = 100f


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

internal data class AmllPreviewGeometry(
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

internal fun formatLyricTimestamp(timeMs: Long): String {
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
