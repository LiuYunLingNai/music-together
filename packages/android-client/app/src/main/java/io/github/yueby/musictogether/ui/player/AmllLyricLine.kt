package io.github.yueby.musictogether.ui.player

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.delay
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import top.yukonga.miuix.kmp.basic.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
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
import io.github.yueby.musictogether.ui.designsystem.LocalPlayerDisplaySettings

@Composable
internal fun AmllLineGroup(
    group: AmllLyricGroup,
    positionMs: State<Float>,
    active: Boolean,
    readingMode: Boolean,
    hidden: Boolean = false,
    blurRadius: Float = 0f,
    motionDelayMs: () -> Long = { 0L },
    wordAnimationEnabled: Boolean,
    onClick: (() -> Unit)?,
    onMainLyricGeometryChanged: ((AmllPrimaryTextGeometry) -> Unit)?,
    onGroupBoundsInRootChanged: ((Rect) -> Unit)?,
    typography: AmllLineTypography,
    motion: AmllLineMotion,
) {
    val displaySettings = LocalPlayerDisplaySettings.current
    val line = group.main
    // Read only while drawing: the word effects follow the clock without recomposing the line each frame.
    val activeNow by rememberUpdatedState(active)
    val position = remember(line, positionMs) {
        val retained = floatArrayOf(line.startTimeMs.toFloat())
        val read: () -> Float = {
            if (activeNow) positionMs.value.also { retained[0] = it } else retained[0]
        }
        read
    }
    // AMLL hands the scale and background springs the same per-line delay as the scroll.
    var motionActive by remember { mutableStateOf(active) }
    LaunchedEffect(active) {
        val wait = motionDelayMs()
        if (wait > 0L) delay(wait)
        motionActive = active
    }
    val blur by animateFloatAsState(
        targetValue = if (active || readingMode) 0f else blurRadius,
        animationSpec = tween(durationMillis = 400, easing = AmllCssEase),
        label = "amllLineBlur",
    )
    val effectRelease = animateFloatAsState(
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
            !displaySettings.lyricScaleEffect || readingMode || motionActive -> 1f
            else -> AmllInactiveScale
        },
        animationSpec = if (displaySettings.lyricSpringAnimation) {
            spring(
                dampingRatio = AmllMainScaleDampingRatio,
                stiffness = AmllMainScaleStiffness,
            )
        } else {
            tween(durationMillis = 220, easing = AmllCssEase)
        },
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
        active = motionActive,
        readingMode = readingMode,
    )
    val backgroundSlideProgress by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0f,
        animationSpec = if (displaySettings.lyricSpringAnimation) {
            spring(
                dampingRatio = motion.positionSpringDampingRatio,
                stiffness = motion.positionSpringStiffness,
            )
        } else {
            tween(durationMillis = 260, easing = AmllCssEase)
        },
        label = "amllBackgroundSlide",
    )
    val backgroundAlphaProgress by animateFloatAsState(
        targetValue = if (backgroundRevealed) 1f else 0f,
        animationSpec = tween(durationMillis = 300, easing = AmllCssEase),
        label = "amllBackgroundAlpha",
    )
    val backgroundLineScale by animateFloatAsState(
        targetValue = if (!displaySettings.lyricScaleEffect || backgroundRevealed) 1f else 0.75f,
        animationSpec = if (displaySettings.lyricSpringAnimation) {
            spring(
                dampingRatio = AmllBackgroundScaleDampingRatio,
                stiffness = AmllBackgroundScaleStiffness,
            )
        } else {
            tween(durationMillis = 260, easing = AmllCssEase)
        },
        label = "amllBackgroundLineScale",
    )
    val groupAlpha by animateFloatAsState(
        targetValue = if (hidden) 0f else amllGroupTargetAlpha(
            active = active,
        ),
        animationSpec = tween(durationMillis = 400, easing = AmllCssEase),
        label = "amllGroupAlpha",
    )
    val (startInsetFraction, endInsetFraction) = amllDuetInsetFractions(
        hasDuetLines = typography.duetInset > 0.dp,
        isDuet = line.isDuet,
    )
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                alpha = groupAlpha
            }
            .blur(radius = blur.dp)
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
                    start = typography.horizontalContentPadding +
                        typography.duetInset *
                        (startInsetFraction / AmllDuetInsetFraction),
                    end = typography.horizontalContentPadding +
                        typography.duetInset *
                        (endInsetFraction / AmllDuetInsetFraction),
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
                    backgroundRevealProgress = { backgroundSlideProgress },
                    backgroundGap = typography.backgroundGap,
                    main = {
                        AmllMainLine(
                            line = line,
                            positionMs = position,
                            active = active,
                            effectReleaseProgress = { effectRelease.value },
                            onPrimaryTextGeometryChanged = onMainLyricGeometryChanged,
                            wordAnimationEnabled = wordAnimationEnabled,
                            readingMode = readingMode,
                            lineScale = { scale },
                            mainFontSize = typography.mainFontSize,
                            translationFontSize = typography.translationFontSize,
                            romanFontSize = typography.romanFontSize,
                        )
                    },
                    background = background?.let { backgroundLine ->
                        @Composable {
                            AmllBackgroundLine(
                                line = backgroundLine,
                                positionMs = position,
                                visible = active,
                                effectReleaseProgress = { effectRelease.value },
                                revealProgress = { backgroundSlideProgress },
                                alphaProgress = { backgroundAlphaProgress },
                                lineScale = { backgroundLineScale },
                                wordAnimationEnabled = wordAnimationEnabled,
                                readingMode = readingMode,
                                placeBeforeMain = backgroundFirst,
                                fontSize = typography.backgroundFontSize,
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
    backgroundRevealProgress: () -> Float,
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
        val reveal = backgroundRevealProgress()
        val backgroundContribution = amllBackgroundHeightContribution(
            backgroundHeight = (backgroundPlaceable?.height ?: 0) + backgroundGapPx,
            revealProgress = reveal,
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
                        (backgroundGapPx * reveal).toInt()
                },
            )
        }
    }
}

@Composable
internal fun AmllMainLine(
    line: LyricLine,
    positionMs: () -> Float,
    active: Boolean,
    effectReleaseProgress: () -> Float,
    onPrimaryTextGeometryChanged: ((AmllPrimaryTextGeometry) -> Unit)?,
    wordAnimationEnabled: Boolean,
    readingMode: Boolean,
    lineScale: () -> Float,
    mainFontSize: Float,
    translationFontSize: Float,
    romanFontSize: Float,
) {
    val displaySettings = LocalPlayerDisplaySettings.current
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                val scale = lineScale()
                scaleX = scale
                scaleY = scale
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
            fontWeight = FontWeight(displaySettings.lyricFontWeight),
        )
        val subAlpha = if (readingMode) AmllReadingSubLineAlpha else AmllSubLineAlpha
        val subLines = listOf<@Composable () -> Unit>(
            {
                line.translatedLyric
                    .takeIf { displaySettings.showTranslation && it.isNotBlank() }
                    ?.let { translated ->
                        Text(
                            text = translated,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = textAlign,
                            fontSize = translationFontSize.sp,
                            lineHeight = (translationFontSize * 1.5f).sp,
                            color = Color.White.copy(alpha = subAlpha),
                        )
                    }
            },
            {
                line.romanLyric
                    .takeIf {
                        displaySettings.showRomanization &&
                            it.isNotBlank() && line.words.none { word -> word.romanText.isNotBlank() }
                    }
                    ?.let { roman ->
                        Text(
                            text = roman,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = textAlign,
                            fontSize = romanFontSize.sp,
                            lineHeight = (romanFontSize * 1.5f).sp,
                            color = Color.White.copy(alpha = subAlpha),
                        )
                    }
            },
        )
        (if (displaySettings.lyricSwapTransRoman) subLines.reversed() else subLines).forEach { it() }
    }
}

@Composable
internal fun AmllBackgroundLine(
    line: LyricLine,
    positionMs: () -> Float,
    visible: Boolean,
    effectReleaseProgress: () -> Float,
    revealProgress: () -> Float,
    alphaProgress: () -> Float,
    lineScale: () -> Float,
    wordAnimationEnabled: Boolean,
    readingMode: Boolean,
    placeBeforeMain: Boolean,
    fontSize: Float,
) {
    val displaySettings = LocalPlayerDisplaySettings.current
    val singing by remember(line, positionMs) {
        val start = line.words.minOfOrNull { it.startTimeMs } ?: line.startTimeMs
        val end = line.words.maxOfOrNull { it.endTimeMs } ?: line.endTimeMs
        derivedStateOf { positionMs().let { it >= start && it < end } }
    }
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
                val reveal = revealProgress()
                val wrapperScale = 0.8f + reveal * 0.2f
                alpha = alphaProgress() * 0.4f
                scaleX = wrapperScale
                scaleY = wrapperScale
                translationY =
                    (if (placeBeforeMain) 1f else -1f) *
                    (1f - reveal) *
                    size.height *
                    0.8f
                transformOrigin = backgroundTransformOrigin
            },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    val scale = lineScale()
                    scaleX = scale
                    scaleY = scale
                    transformOrigin = backgroundTransformOrigin
                },
        ) {
            AmllWordLine(
                line = line,
                positionMs = positionMs,
                active = visible && singing,
                effectReleaseProgress = effectReleaseProgress,
                wordAnimationEnabled = wordAnimationEnabled,
                readingMode = readingMode,
                fontSize = fontSize,
                fontWeight = FontWeight(displaySettings.lyricFontWeight),
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
