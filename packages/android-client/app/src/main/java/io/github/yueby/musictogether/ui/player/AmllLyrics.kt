package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.amllLineSpringParameters
import io.github.yueby.musictogether.lyrics.prepareAmllLyricGroups
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop

@Composable
internal fun LyricsPanel(
    lyrics: LyricsState,
    positionSeconds: Double,
    lyricOffsetMs: Int = 0,
    isPlaying: Boolean,
    onSeek: ((Double) -> Unit)? = null,
    alignToTop: Boolean = false,
) {
    val displaySettings = LocalPlayerDisplaySettings.current
    val rawPositionMs = (positionSeconds * 1_000.0 - lyricOffsetMs).toFloat().coerceAtLeast(0f)
    val wordAnimationEnabled = remember(lyrics.source) {
        shouldUseAmllWordAnimation(lyrics.source)
    }
    val groups = remember(lyrics.lines, wordAnimationEnabled) {
        prepareAmllLyricGroups(
            input = lyrics.lines,
            tryAdvanceStartTime = wordAnimationEnabled,
        )
    }
    val focusLeadTimeMs = if (!wordAnimationEnabled && isPlaying) {
        PlainLyricFocusLeadTimeMs
    } else {
        0L
    }
    val motionPolicy = rememberAmllMotionPolicy()
    val playbackTimeline = rememberAmllPlaybackTimeline(
        groups = groups,
        rawPositionMs = rawPositionMs,
        isPlaying = isPlaying,
        resetKey = lyrics.trackId to lyricOffsetMs,
        minimumFrameIntervalNanos = motionPolicy.minimumFrameIntervalNanos,
        focusLeadTimeMs = focusLeadTimeMs,
    )
    val timelineFrame by playbackTimeline.frame
    val smoothPositionMs = playbackTimeline.positionMs
    val activeGroupIndices = timelineFrame.bufferedGroupIndices
    val currentInterlude = timelineFrame.interlude
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
    var measuredMainLyricGeometry by remember(lyrics.trackId, groups) {
        mutableStateOf<IndexedValue<AmllPrimaryTextGeometry>?>(null)
    }
    var measuredLyricGroupBounds by remember(lyrics.trackId, groups) {
        mutableStateOf<IndexedValue<androidx.compose.ui.geometry.Rect>?>(null)
    }
    var focusedGroupBoundsMeasurement by remember(lyrics.trackId, groups) {
        mutableStateOf<IndexedValue<androidx.compose.ui.geometry.Rect>?>(null)
    }
    val listItems = remember(lyrics.trackId, groups) {
        buildAmllListItems(
            trackId = lyrics.trackId,
            groups = groups,
        )
    }
    val focusedGroupIndex = timelineFrame.focusedGroupIndex
    val focusedListIndex = listItems.indexOfFirst { item ->
        item.groupIndex == focusedGroupIndex
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
                if (alignToTop) displaySettings.lyricAlignPosition else AmllCenteredAlignPosition
            val mainFontSize = (
                minOf(maxHeight.value * 0.05f, maxWidth.value * 0.07f) *
                    AmllMainFontScale * displaySettings.lyricFontScale
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
            var automaticScrollInProgress by remember(lyrics.trackId, groups) {
                mutableStateOf(false)
            }
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
            val previewGroupIndex by rememberAmllPreviewGroupIndex(
                listItems = listItems,
                listState = listState,
                manualBrowseActive = manualBrowseActive,
                alignPosition = alignPosition,
                alignToTop = alignToTop,
            )
            val visibleItemSizeSignature by remember(listState) {
                derivedStateOf {
                    listState.layoutInfo.visibleItemsInfo.fold(1) { signature, item ->
                        31 * signature + 31 * item.index + item.size
                    }
                }
            }
            val previewGeometry by rememberAmllPreviewGeometry(
                listItems = listItems,
                listState = listState,
                previewGroupIndex = previewGroupIndex,
                measuredMainLyricGeometry = measuredMainLyricGeometry,
                measuredLyricGroupBounds = measuredLyricGroupBounds,
            )
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
            val lineTypography = remember(
                mainFontSize,
                translationFontSize,
                romanFontSize,
                backgroundFontSize,
                duetInset,
                density,
            ) {
                AmllLineTypography(
                    mainFontSize = mainFontSize,
                    translationFontSize = translationFontSize,
                    romanFontSize = romanFontSize,
                    backgroundFontSize = backgroundFontSize,
                    horizontalContentPadding = 20.dp,
                    duetInset = duetInset,
                    backgroundGap = with(density) {
                        (mainFontSize * 0.3f).sp.toDp()
                    },
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

            LaunchedEffect(listState, focusedListIndex, manualBrowseActive) {
                snapshotFlow {
                    visibleItemSizeSignature to listState.isScrollInProgress
                }
                    .distinctUntilChanged()
                    .drop(1)
                    .collect { (_, scrolling) ->
                        if (
                            !scrolling &&
                            !automaticScrollInProgress &&
                            !manualBrowseActive &&
                            focusedListIndex >= 0
                        ) {
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
                    automaticScrollInProgress = true
                    try {
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
                    } else if (playbackLayoutChanged || !focusChanged) {
                        withFrameNanos { }
                        listState.scrollFocusedItemToAdaptiveAnchor(
                            index = focusedListIndex,
                            animate = false,
                            alignPosition = alignPosition,
                            alignToTop = alignToTop,
                            scrollMotion = scrollMotion,
                        )
                    } else {
                        // Wait for the focused lyric and any temporary interlude
                        // spacing to finish layout before measuring the target.
                        withFrameNanos { }
                        val springParameters = amllLineSpringParameters(
                            currentStartTimeMs = groups[focusedGroupIndex].startTimeMs,
                            previousStartTimeMs =
                                groups.getOrNull(focusedGroupIndex - 1)?.startTimeMs,
                            stabilize = interlude != null || !focusChanged,
                        )
                        val aligned = listState.scrollFocusedItemToAdaptiveAnchor(
                            index = focusedListIndex,
                            animate = displaySettings.lyricSpringAnimation,
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
                    } finally {
                        automaticScrollInProgress = false
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
                        val lineMotion = remember(
                            visualSpringParameters,
                        ) {
                            AmllLineMotion(
                                positionSpringStiffness =
                                    visualSpringParameters.composeStiffness,
                                positionSpringDampingRatio =
                                    visualSpringParameters.dampingRatio,
                            )
                        }
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            key(timelineFrame.seekGeneration) {
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
                                        onGroupBoundsInRootChanged = if (
                                            item.groupIndex == focusedGroupIndex ||
                                            (
                                                manualBrowseActive &&
                                                    item.groupIndex == previewGroupIndex
                                                )
                                        ) {
                                            { bounds ->
                                                if (item.groupIndex == focusedGroupIndex) {
                                                    focusedGroupBoundsMeasurement = IndexedValue(
                                                        index = item.groupIndex,
                                                        value = bounds,
                                                    )
                                                }
                                                if (
                                                    manualBrowseActive &&
                                                    item.groupIndex == previewGroupIndex
                                                ) {
                                                    val measured = IndexedValue(
                                                        index = item.groupIndex,
                                                        value = bounds,
                                                    )
                                                    if (measuredLyricGroupBounds != measured) {
                                                        measuredLyricGroupBounds = measured
                                                    }
                                                }
                                            }
                                        } else {
                                            null
                                        },
                                        typography = lineTypography,
                                        motion = lineMotion,
                                    )
                            }
                            if (item.groupIndex == interlude?.anchorGroupIndex) {
                                Spacer(
                                    modifier = Modifier.height(
                                        with(density) {
                                            amllInterludeReservedHeight(
                                                mainFontSize.sp.toPx(),
                                            ).toDp()
                                        },
                                    ),
                                )
                            }
                        }
                    }
                }
            }

            interlude?.let { activeInterlude ->
                AmllInterludeOverlay(
                    interlude = activeInterlude,
                    positionMs = smoothPositionMs,
                    anchorBoundsInRoot = amllMeasurementForGroup(
                        measurement = focusedGroupBoundsMeasurement,
                        groupIndex = focusedGroupIndex,
                    ),
                    fontSize = mainFontSize,
                    horizontalPaddingPx = with(density) { 20.dp.toPx() },
                    modifier = Modifier.fillMaxSize(),
                )
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

private const val PlainLyricFocusLeadTimeMs = 300L
