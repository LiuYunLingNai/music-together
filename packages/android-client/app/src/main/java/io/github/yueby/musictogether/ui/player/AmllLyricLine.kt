package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.model.LyricLine

@Composable
internal fun AmllLineGroup(
    group: AmllLyricGroup,
    positionMs: State<Float>,
    active: Boolean,
    readingMode: Boolean,
    wordAnimationEnabled: Boolean,
    onClick: (() -> Unit)?,
    onMainLyricGeometryChanged: ((AmllPrimaryTextGeometry) -> Unit)?,
    onGroupBoundsInRootChanged: ((Rect) -> Unit)?,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
    backgroundFontSize: Float,
    horizontalContentPadding: Dp,
    duetInset: Dp,
    backgroundGap: Dp,
    positionSpringStiffness: Float,
    positionSpringDampingRatio: Float,
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
        animationSpec = tween(
            durationMillis =
                if (active) AmllMaskAttackDurationMs else AmllMaskReleaseDurationMs,
            easing = AmllMaskAlphaEasing,
        ),
        label = "amllEffectRelease",
    )
    val scale by animateFloatAsState(
        targetValue = when {
            readingMode || active -> 1f
            else -> AmllInactiveScale
        },
        animationSpec = spring(
            dampingRatio = AmllMainScaleDampingRatio,
            stiffness = AmllMainScaleStiffness,
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
    val backgroundRevealed = background != null && shouldRevealAmllBackground(
        active = active,
        readingMode = readingMode,
    )
    val backgroundSlideProgress by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0f,
        animationSpec = spring(
            dampingRatio = positionSpringDampingRatio,
            stiffness = positionSpringStiffness,
        ),
        label = "amllBackgroundSlide",
    )
    val backgroundAlphaProgress by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0f,
        animationSpec = tween(durationMillis = 300, easing = AmllCssEase),
        label = "amllBackgroundAlpha",
    )
    val backgroundLineScale by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0.75f,
        animationSpec = spring(
            dampingRatio = AmllBackgroundScaleDampingRatio,
            stiffness = AmllBackgroundScaleStiffness,
        ),
        label = "amllBackgroundLineScale",
    )
    val groupAlpha by animateFloatAsState(
        targetValue = amllGroupTargetAlpha(
            active = active,
        ),
        animationSpec = tween(durationMillis = 400, easing = AmllCssEase),
        label = "amllGroupAlpha",
    )
    val (startInsetFraction, endInsetFraction) = amllDuetInsetFractions(
        hasDuetLines = duetInset > 0.dp,
        isDuet = line.isDuet,
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = groupAlpha }
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
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = horizontalContentPadding +
                        duetInset * (startInsetFraction / AmllDuetInsetFraction),
                    end = horizontalContentPadding +
                        duetInset * (endInsetFraction / AmllDuetInsetFraction),
                ),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        onGroupBoundsInRootChanged?.let { onBoundsChanged ->
                            Modifier.onGloballyPositioned { coordinates ->
                                onBoundsChanged(coordinates.boundsInRoot())
                            }
                        } ?: Modifier,
                    ),
            ) {
                AmllMainAndBackgroundLayout(
                    backgroundFirst = backgroundFirst,
                    backgroundRevealProgress = backgroundSlideProgress,
                    backgroundGap = backgroundGap,
                    main = {
                        AmllMainLine(
                            line = line,
                            positionMs = currentPositionMs,
                            active = active,
                            effectReleaseProgress = effectReleaseProgress,
                            onPrimaryTextGeometryChanged = onMainLyricGeometryChanged,
                            wordAnimationEnabled = wordAnimationEnabled,
                            readingMode = readingMode,
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
                                revealProgress = backgroundSlideProgress,
                                alphaProgress = backgroundAlphaProgress,
                                lineScale = backgroundLineScale,
                                wordAnimationEnabled = wordAnimationEnabled,
                                readingMode = readingMode,
                                placeBeforeMain = backgroundFirst,
                                fontSize = backgroundFontSize,
                            )
                        }
                    },
                )
            }
        }
    }
}


@Composable
internal fun AmllMainAndBackgroundLayout(
    backgroundFirst: Boolean,
    backgroundRevealProgress: Float,
    backgroundGap: Dp,
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
        val backgroundGapPx = if (backgroundPlaceable == null) 0 else backgroundGap.roundToPx()
        val backgroundContribution = amllBackgroundHeightContribution(
            backgroundHeight = (backgroundPlaceable?.height ?: 0) + backgroundGapPx,
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
                    backgroundContribution - backgroundPlaceable.height - backgroundGapPx
                } else {
                    mainPlaceable.height +
                        (backgroundGapPx * backgroundRevealProgress).toInt()
                },
            )
        }
    }
}

@Composable
internal fun AmllMainLine(
    line: LyricLine,
    positionMs: Float,
    active: Boolean,
    effectReleaseProgress: Float,
    onPrimaryTextGeometryChanged: ((AmllPrimaryTextGeometry) -> Unit)?,
    wordAnimationEnabled: Boolean,
    readingMode: Boolean,
    lineScale: Float,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
) {
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = lineScale
                scaleY = lineScale
                transformOrigin =
                    if (line.isDuet) TransformOrigin(1f, 0.5f) else TransformOrigin(0f, 0.5f)
            },
    ) {
        AmllWordLine(
            line = line,
            positionMs = positionMs,
            active = active,
            effectReleaseProgress = effectReleaseProgress,
            onPrimaryTextGeometryChanged = onPrimaryTextGeometryChanged,
            wordAnimationEnabled = wordAnimationEnabled,
            readingMode = readingMode,
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
                color = Color.White.copy(
                    alpha = if (readingMode) AmllReadingSubLineAlpha else AmllSubLineAlpha,
                ),
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
                    color = Color.White.copy(
                        alpha = if (readingMode) AmllReadingSubLineAlpha else AmllSubLineAlpha,
                    ),
                )
            }
    }
}

@Composable
internal fun AmllBackgroundLine(
    line: LyricLine,
    positionMs: Float,
    visible: Boolean,
    effectReleaseProgress: Float,
    revealProgress: Float,
    alphaProgress: Float,
    lineScale: Float,
    wordAnimationEnabled: Boolean,
    readingMode: Boolean,
    placeBeforeMain: Boolean,
    fontSize: Float,
) {
    val wrapperScale = 0.8f + revealProgress * 0.2f
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
                alpha = alphaProgress * 0.4f
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
                wordAnimationEnabled = wordAnimationEnabled,
                readingMode = readingMode,
                fontSize = fontSize,
                fontWeight = FontWeight.SemiBold,
                isBackground = true,
            )
        }
    }
}

internal const val AmllMainScaleStiffness = 50f
internal const val AmllMainScaleDampingRatio = 0.8838835f
internal const val AmllBackgroundScaleStiffness = 50f
internal const val AmllBackgroundScaleDampingRatio = 1.4142135f
private val AmllCssEase = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)
