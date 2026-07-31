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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
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
internal const val AmllDuetInsetFraction = 0.15f
internal const val AmllSubLineAlpha = 0.3f
internal const val AmllInactiveMainLineAlpha = 0.2f
internal const val AmllReadingMainLineAlpha = 0.4f
internal const val AmllReadingSubLineAlpha = 0.42f
internal const val AmllActiveGroupAlpha = 0.85f
internal const val AmllPositionDampingRatio = 0.83f
internal const val AmllSpringStiffness = 100f
internal const val AmllPlaybackRelayoutFrameCount = 30


internal sealed interface AmllListItem {
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

internal fun buildAmllListItems(
    trackId: String?,
    groups: List<AmllLyricGroup>,
    interlude: AmllInterlude?,
): List<AmllListItem> = buildList {
    groups.forEachIndexed { index, group ->
        if (interlude?.anchorGroupIndex == index - 1) {
            add(
                AmllListItem.Interlude(
                    trackId = trackId,
                    value = interlude,
                ),
            )
        }
        add(
            AmllListItem.Line(
                trackId = trackId,
                groupIndex = index,
                group = group,
            ),
        )
    }
}

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

internal fun amllDuetInsetFractions(
    hasDuetLines: Boolean,
    isDuet: Boolean,
): Pair<Float, Float> = when {
    !hasDuetLines -> 0f to 0f
    isDuet -> AmllDuetInsetFraction to 0f
    else -> 0f to AmllDuetInsetFraction
}

internal fun amllGroupTargetAlpha(
    active: Boolean,
): Float = if (active) AmllActiveGroupAlpha else 1f

internal fun amllInactiveMainLineAlpha(readingMode: Boolean): Float =
    if (readingMode) AmllReadingMainLineAlpha else AmllInactiveMainLineAlpha

internal fun shouldRevealAmllBackground(
    active: Boolean,
    readingMode: Boolean,
): Boolean = active || readingMode

internal fun shouldUseAmllWordAnimation(source: String?): Boolean =
    source in setOf("ttml", "wordByWord", "yrc")

internal fun initialAmllListIndex(
    focusedListIndex: Int,
    itemCount: Int,
): Int = if (itemCount > 0) {
    focusedListIndex.coerceAtLeast(0).coerceAtMost(itemCount - 1)
} else {
    0
}

internal fun <T> amllMeasurementForGroup(
    measurement: IndexedValue<T>?,
    groupIndex: Int,
): T? = measurement?.takeIf { it.index == groupIndex }?.value

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
    val motionPolicy = rememberAmllMotionPolicy()
    val playbackTimeline = rememberAmllPlaybackTimeline(
        groups = groups,
        rawPositionMs = rawPositionMs,
        isPlaying = isPlaying,
        resetKey = lyrics.trackId to lyricOffsetMs,
        minimumFrameIntervalNanos = motionPolicy.minimumFrameIntervalNanos,
    )
    val timelineFrame by playbackTimeline.frame
    val smoothPositionMs = playbackTimeline.positionMs
    val wordAnimationEnabled = remember(lyrics.source) {
        shouldUseAmllWordAnimation(lyrics.source)
    }
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
    var renderedInterlude by remember(lyrics.trackId, groups) {
        mutableStateOf<AmllInterlude?>(null)
    }
    LaunchedEffect(interlude) {
        if (interlude != null) {
            renderedInterlude = interlude
        } else if (renderedInterlude != null) {
            // AMLL only lets the currently active waiting indicator affect
            // lyric positions. Retain it just long enough to finish the exit
            // shrink, then remove it from the list so ordinary lines never
            // inherit a permanent extra Arrangement gap.
            delay(AmllInterludeTransitionDurationMs)
            renderedInterlude = null
        }
    }
    var measuredMainLyricGeometry by remember(lyrics.trackId, groups) {
        mutableStateOf<IndexedValue<AmllPrimaryTextGeometry>?>(null)
    }
    var measuredLyricGroupBounds by remember(lyrics.trackId, groups) {
        mutableStateOf<IndexedValue<androidx.compose.ui.geometry.Rect>?>(null)
    }
    val listItems = remember(lyrics.trackId, groups, renderedInterlude) {
        buildAmllListItems(
            trackId = lyrics.trackId,
            groups = groups,
            interlude = renderedInterlude,
        )
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
            Text(
                text = "歌词加载中...",
                color = Color.White.copy(alpha = 0.5f),
                fontSize = 20.sp,
            )
        }

        groups.isEmpty() -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = lyrics.error ?: "暂无歌词",
                color = Color.White.copy(alpha = 0.5f),
                fontSize = 20.sp,
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
            val hasDuetLines = remember(groups) {
                groups.any { group -> group.main.isDuet }
            }
            val duetInset = if (hasDuetLines) {
                maxWidth * AmllDuetInsetFraction
            } else {
                0.dp
            }
            val density = LocalDensity.current
            val lineGap = with(density) { (mainFontSize * 0.4f).sp.toDp() }
            val edgePadding = maxOf(8.dp, lineGap)
            val firstLineInset =
                maxOf(edgePadding, maxHeight * AmllTopFadeEnd + lineGap)
            val lastLineInset =
                maxOf(edgePadding, maxHeight * (1f - AmllBottomFadeStart) + lineGap)
            val initialListIndex = remember(lyrics.trackId, groups) {
                initialAmllListIndex(
                    focusedListIndex = focusedListIndex,
                    itemCount = listItems.size,
                )
            }
            val listState = remember(lyrics.trackId, groups) {
                LazyListState(firstVisibleItemIndex = initialListIndex)
            }
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
            var previousIsPlaying by remember(lyrics.trackId, groups) {
                mutableStateOf(isPlaying)
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
                        val textGeometry = amllMeasurementForGroup(
                            measurement = measuredMainLyricGeometry,
                            groupIndex = lineItem.groupIndex,
                        )
                        val groupBounds = amllMeasurementForGroup(
                            measurement = measuredLyricGroupBounds,
                            groupIndex = lineItem.groupIndex,
                        )
                        if (textGeometry != null && groupBounds != null) {
                            AmllPreviewGeometry(
                                primaryText = textGeometry,
                                groupBoundsInRoot = groupBounds,
                                group = lineItem.group,
                            )
                        } else null
                    }
                }
            }
            val visualSpringParameters = remember(
                groups,
                focusedGroupIndex,
                interlude,
            ) {
                val focusedGroup = groups.getOrNull(focusedGroupIndex) ?: groups.first()
                amllLineSpringParameters(
                    currentStartTimeMs = focusedGroup.startTimeMs,
                    previousStartTimeMs =
                        groups.getOrNull(focusedGroupIndex - 1)?.startTimeMs,
                    stabilize = interlude != null,
                )
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
                isPlaying,
            ) {
                if (focusedListIndex >= 0 && !manualBrowseActive) {
                    val playbackLayoutChanged = previousIsPlaying != isPlaying
                    previousIsPlaying = isPlaying
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
                        val focusAlreadyVisible = listState.layoutInfo.visibleItemsInfo.any {
                            it.index == focusedListIndex
                        }
                        if (!focusAlreadyVisible) {
                            listState.scrollToItem(index = focusedListIndex)
                        }
                        withFrameNanos { }
                        listState.scrollFocusedItemToAdaptiveAnchor(
                            index = focusedListIndex,
                            animate = false,
                            alignPosition = alignPosition,
                            alignToTop = alignToTop,
                            scrollMotion = scrollMotion,
                        )
                    } else if (playbackLayoutChanged) {
                        repeat(AmllPlaybackRelayoutFrameCount) {
                            withFrameNanos { }
                            listState.scrollFocusedItemToAdaptiveAnchor(
                                index = focusedListIndex,
                                animate = false,
                                alignPosition = alignPosition,
                                alignToTop = alignToTop,
                                scrollMotion = scrollMotion,
                            )
                        }
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
                            stiffness = springParameters.composeStiffness,
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

            CompositionLocalProvider(
                LocalAmllExpensiveEffectsEnabled provides
                    motionPolicy.expensiveEffectsEnabled,
            ) {
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
                        top = firstLineInset,
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
                                is AmllListItem.Line -> key(timelineFrame.seekGeneration) {
                                    AmllLineGroup(
                                        group = item.group,
                                        positionMs = smoothPositionMs,
                                        active =
                                            item.groupIndex in activeGroupIndices &&
                                                interlude == null,
                                        readingMode = manualBrowseActive || !isPlaying,
                                        wordAnimationEnabled = wordAnimationEnabled,
                                        onClick = onSeek?.let { seek ->
                                            {
                                                dismissedInterludeKey = currentInterludeKey
                                                manualBrowseActive = false
                                                seek(item.group.main.startTimeMs / 1_000.0)
                                            }
                                        },
                                        onMainLyricGeometryChanged =
                                            if (
                                                manualBrowseActive &&
                                                item.groupIndex == previewGroupIndex
                                            ) {
                                                { geometry ->
                                                    val measured = IndexedValue(
                                                        index = item.groupIndex,
                                                        value = geometry,
                                                    )
                                                    if (measuredMainLyricGeometry != measured) {
                                                        measuredMainLyricGeometry = measured
                                                    }
                                                }
                                            } else {
                                                null
                                            },
                                        onGroupBoundsInRootChanged =
                                            if (
                                                manualBrowseActive &&
                                                item.groupIndex == previewGroupIndex
                                            ) {
                                                { bounds ->
                                                    val measured = IndexedValue(
                                                        index = item.groupIndex,
                                                        value = bounds,
                                                    )
                                                    if (measuredLyricGroupBounds != measured) {
                                                        measuredLyricGroupBounds = measured
                                                    }
                                                }
                                            } else {
                                                null
                                            },
                                        mainFontSize = mainFontSize,
                                        translationFontSize = translationFontSize,
                                        romanFontSize = romanFontSize,
                                        backgroundFontSize = backgroundFontSize,
                                        horizontalContentPadding = 20.dp,
                                        duetInset = duetInset,
                                        backgroundGap = with(density) {
                                            (mainFontSize * 0.3f).sp.toDp()
                                        },
                                        positionSpringStiffness =
                                            visualSpringParameters.composeStiffness,
                                        positionSpringDampingRatio =
                                            visualSpringParameters.dampingRatio,
                                    )
                                }

                                is AmllListItem.Interlude -> AmllInterludeSlot(
                                    interlude = item.value,
                                    positionMs = smoothPositionMs,
                                    active = item.value == interlude,
                                    fontSize = mainFontSize,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 20.dp),
                                )
                            }
                        }
                    }
                }
            }

            AmllTimestampPreview(
                geometry = previewGeometry,
                visible = manualBrowseActive,
                mainFontSize = mainFontSize,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
