package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import io.github.yueby.musictogether.model.LyricLine

@Composable
internal fun AmllLineGroup(
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
    duetInset: Dp,
) {
    val expensiveEffectsEnabled = LocalAmllExpensiveEffectsEnabled.current
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
        ).takeIf { expensiveEffectsEnabled } ?: 0f,
        animationSpec = tween(durationMillis = 400),
        label = "amllLineBlur",
    )
    val (startInsetFraction, endInsetFraction) = amllDuetInsetFractions(
        hasDuetLines = duetInset > 0.dp,
        isDuet = line.isDuet,
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
            )
            .padding(
                start = duetInset * (startInsetFraction / AmllDuetInsetFraction),
                end = duetInset * (endInsetFraction / AmllDuetInsetFraction),
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
internal fun AmllMainAndBackgroundLayout(
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
internal fun AmllMainLine(
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
                color = Color.White.copy(alpha = AmllSubLineAlpha),
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
                    color = Color.White.copy(alpha = AmllSubLineAlpha),
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
