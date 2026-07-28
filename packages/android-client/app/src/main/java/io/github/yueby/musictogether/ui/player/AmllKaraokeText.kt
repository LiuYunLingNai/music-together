package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.lyrics.AmllEmphasisProfile
import io.github.yueby.musictogether.lyrics.AmllMeasuredChunk
import io.github.yueby.musictogether.lyrics.AmllWordChunk
import io.github.yueby.musictogether.lyrics.amllEmphasisEasing
import io.github.yueby.musictogether.lyrics.amllEmphasisProfile
import io.github.yueby.musictogether.lyrics.amllMaskAlphaAt
import io.github.yueby.musictogether.lyrics.amllMaskBoundaries
import io.github.yueby.musictogether.lyrics.amllWordProgress
import io.github.yueby.musictogether.lyrics.calculateAmllBalancedBreaks
import io.github.yueby.musictogether.lyrics.chunkAmllWords
import io.github.yueby.musictogether.lyrics.isAmllCjk
import io.github.yueby.musictogether.lyrics.shouldAmllEmphasize
import io.github.yueby.musictogether.lyrics.splitAmllGraphemes
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import kotlin.math.PI
import kotlin.math.sin

private val AmllWordFloatEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

@Composable
internal fun AmllWordLine(
    line: LyricLine,
    positionMs: Float,
    active: Boolean,
    floatReleaseProgress: Float = if (active) 1f else 0f,
    onPrimaryTextCenterInRootChanged: ((Float) -> Unit)? = null,
    previewed: Boolean = false,
    isPlaying: Boolean,
    isDynamic: Boolean,
    lineScale: Float,
    fontSize: Float,
    fontWeight: FontWeight,
    isBackground: Boolean = false,
) {
    val hasDynamicTiming = isDynamic && line.words.any {
        it.endTimeMs > it.startTimeMs
    }
    val textAlign = if (line.isDuet) TextAlign.End else TextAlign.Start
    val scaleFactor = ((lineScale - 0.97f) / 0.03f).coerceIn(0f, 1f)
    val dynamicDarkAlpha = scaleFactor * 0.2f + 0.2f
    val dynamicBrightAlpha = scaleFactor * 0.8f + 0.2f
    val targetDarkAlpha = dynamicDarkAlpha
    val targetBrightAlpha = when {
        active -> dynamicBrightAlpha
        previewed -> maxOf(dynamicDarkAlpha, 0.56f)
        else -> dynamicDarkAlpha
    }
    val darkAlpha = rememberAmllMaskAlpha(targetDarkAlpha).value
    val brightAlpha = rememberAmllMaskAlpha(targetBrightAlpha).value
    val baseAlpha = if (previewed && !active) brightAlpha else darkAlpha

    if (!hasDynamicTiming) {
        Text(
            text = line.text,
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    onPrimaryTextCenterInRootChanged?.let { onCenterChanged ->
                        Modifier.onGloballyPositioned { coordinates ->
                            onCenterChanged(
                                coordinates.positionInRoot().y +
                                    coordinates.size.height / 2f,
                            )
                        }
                    } ?: Modifier,
                ),
            textAlign = textAlign,
            color = Color.White.copy(alpha = if (active) brightAlpha else baseAlpha),
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
        )
        return
    }

    val chunks = remember(line.words) { chunkAmllWords(line) }
    val hasRomanWords = line.words.any { it.romanText.isNotBlank() }
    val hasRubyWords = line.words.any { it.ruby.isNotEmpty() }
    val density = LocalDensity.current
    val wrappedLineGap = with(density) { (fontSize * 0.12f).sp.roundToPx() }
    val emphasisHeadroom = with(density) { (fontSize * 0.16f).sp.toDp() }

    AmllBalancedWordLayout(
        chunks = chunks,
        alignEnd = line.isDuet,
        verticalGapPx = wrappedLineGap,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = emphasisHeadroom)
            .then(
                onPrimaryTextCenterInRootChanged?.let { onCenterChanged ->
                    Modifier.onGloballyPositioned { coordinates ->
                        onCenterChanged(
                            coordinates.positionInRoot().y +
                                coordinates.size.height / 2f,
                        )
                    }
                } ?: Modifier,
            ),
    ) { chunk ->
        if (chunk.text.isBlank()) {
            Text(
                // Compose may measure a trailing regular space as zero width.
                // AMLL inserts a DOM text node here, so use non-breaking spaces
                // to retain the same visible advance without joining words.
                text = chunk.text.map { character ->
                    if (character.isWhitespace()) '\u00A0' else character
                }.joinToString(""),
                fontSize = fontSize.sp,
                lineHeight = (fontSize * 1.25f).sp,
                maxLines = 1,
            )
        } else {
            AmllKaraokeChunk(
                chunk = chunk,
                lastLineWord = line.words.lastOrNull()?.text.orEmpty(),
                positionMs = positionMs,
                floatReleaseProgress = floatReleaseProgress,
                reserveRomanSpace = hasRomanWords,
                reserveRubySpace = hasRubyWords,
                fontSize = fontSize,
                fontWeight = fontWeight,
                darkAlpha = baseAlpha,
                brightAlpha = brightAlpha,
                isBackground = isBackground,
            )
        }
    }
}

private data class AmllFlowLine(
    val itemIndices: MutableList<Int> = mutableListOf(),
    var width: Int = 0,
    var height: Int = 0,
)

@Composable
private fun AmllBalancedWordLayout(
    chunks: List<AmllWordChunk>,
    alignEnd: Boolean,
    verticalGapPx: Int,
    modifier: Modifier = Modifier,
    content: @Composable (AmllWordChunk) -> Unit,
) {
    Layout(
        modifier = modifier,
        content = {
            for (chunk in chunks) {
                content(chunk)
            }
        },
    ) { measurables, constraints ->
        val placeables = measurables.map { measurable ->
            measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
        }
        val breaks = calculateAmllBalancedBreaks(
            children = chunks.mapIndexed { index, chunk ->
                AmllMeasuredChunk(
                    width = placeables[index].width.toDouble(),
                    text = chunk.text,
                    isSpace = chunk.text.isBlank(),
                )
            },
            containerWidth = constraints.maxWidth.toDouble(),
        ).toSet()
        val lines = mutableListOf(AmllFlowLine())

        fun append(index: Int) {
            val placeable = placeables[index]
            val line = lines.last()
            line.itemIndices += index
            line.width += placeable.width
            line.height = maxOf(line.height, placeable.height)
        }

        chunks.indices.forEach { index ->
            if (index in breaks) {
                lines += AmllFlowLine()
            }
            append(index)
        }

        val contentHeight = lines.sumOf { it.height } +
            verticalGapPx * (lines.size - 1).coerceAtLeast(0)
        layout(
            width = constraints.maxWidth,
            height = contentHeight.coerceIn(constraints.minHeight, constraints.maxHeight),
        ) {
            var y = 0
            lines.forEach { line ->
                var x = if (alignEnd) constraints.maxWidth - line.width else 0
                line.itemIndices.forEach { index ->
                    val placeable = placeables[index]
                    placeable.placeRelative(
                        x = x,
                        y = y + line.height - placeable.height,
                    )
                    x += placeable.width
                }
                y += line.height + verticalGapPx
            }
        }
    }
}

@Composable
private fun AmllKaraokeChunk(
    chunk: AmllWordChunk,
    lastLineWord: String,
    positionMs: Float,
    floatReleaseProgress: Float,
    reserveRomanSpace: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    darkAlpha: Float,
    brightAlpha: Float,
    isBackground: Boolean,
) {
    val mergedWord = remember(chunk.words) {
        LyricWord(
            text = chunk.text,
            startTimeMs = chunk.startTimeMs,
            endTimeMs = chunk.endTimeMs,
        )
    }
    val emphasize = chunk.words.any(::shouldAmllEmphasize) ||
        (!isAmllCjk(chunk.text) && shouldAmllEmphasize(mergedWord))
    val profile = remember(chunk, lastLineWord) {
        amllEmphasisProfile(chunk, lastLineWord)
    }
    val graphemesByWord = remember(chunk.words) {
        chunk.words.map { splitAmllGraphemes(it.text.trim()) }
    }
    val rubyGlyphCount = chunk.words.sumOf { word ->
        word.ruby.sumOf { ruby -> splitAmllGraphemes(ruby.text).size }
    }
    val glyphCount = (
        if (rubyGlyphCount > 0) {
            rubyGlyphCount
        } else {
            graphemesByWord.sumOf(List<String>::size)
        }
        ).coerceAtLeast(1)
    val glyphOffsets = remember(graphemesByWord) {
        var offset = 0
        graphemesByWord.map { glyphs ->
            offset.also { offset += glyphs.size }
        }
    }

    Row(verticalAlignment = Alignment.Bottom) {
        chunk.words.forEachIndexed { index, word ->
            AmllKaraokeWord(
                word = word,
                graphemes = graphemesByWord[index],
                positionMs = positionMs,
                floatReleaseProgress = floatReleaseProgress,
                reserveRomanSpace = reserveRomanSpace,
                reserveRubySpace = reserveRubySpace,
                fontSize = fontSize,
                fontWeight = fontWeight,
                darkAlpha = darkAlpha,
                brightAlpha = brightAlpha,
                emphasize = emphasize,
                isBackground = isBackground,
                chunkStartTimeMs = chunk.startTimeMs,
                profile = profile,
                glyphIndexOffset = glyphOffsets[index],
                glyphCount = glyphCount,
            )
        }
    }
}

@Composable
private fun AmllKaraokeWord(
    word: LyricWord,
    graphemes: List<String>,
    positionMs: Float,
    floatReleaseProgress: Float,
    reserveRomanSpace: Boolean,
    reserveRubySpace: Boolean,
    fontSize: Float,
    fontWeight: FontWeight,
    darkAlpha: Float,
    brightAlpha: Float,
    emphasize: Boolean,
    isBackground: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
) {
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val wordFloatDuration = (word.endTimeMs - word.startTimeMs).coerceAtLeast(1_000L)
    val wordFloatProgress =
        ((positionMs - word.startTimeMs) / wordFloatDuration).coerceIn(0f, 1f)
    val wordFloat = AmllWordFloatEasing.transform(wordFloatProgress)
    val wordFloatAmount = if (isBackground) 0.1f else 0.05f
    val highlightProgress = amllWordProgress(word, positionMs)

    Column(
        modifier = Modifier.graphicsLayer {
            translationY =
                -wordFloat * wordFloatAmount * fontSizePx * floatReleaseProgress
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (reserveRubySpace) {
            Row(verticalAlignment = Alignment.Bottom) {
                if (word.ruby.isEmpty()) {
                    Text(
                        text = " ",
                        color = Color.Transparent,
                        fontSize = (fontSize * 0.5f).sp,
                        lineHeight = (fontSize * 0.5f).sp,
                        maxLines = 1,
                    )
                } else {
                    word.ruby.forEach { ruby ->
                        val rubyProgress = when {
                            positionMs <= ruby.startTimeMs -> 0f
                            positionMs >= ruby.endTimeMs -> 1f
                            else -> (
                                (positionMs - ruby.startTimeMs) /
                                    (ruby.endTimeMs - ruby.startTimeMs).coerceAtLeast(1L)
                                ).coerceIn(0f, 1f)
                        }
                        Text(
                            text = ruby.text,
                            color = Color.White.copy(
                                alpha = darkAlpha +
                                    rubyProgress * (brightAlpha - darkAlpha),
                            ),
                            fontSize = (fontSize * 0.5f).sp,
                            lineHeight = (fontSize * 0.5f).sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        Box {
            AmllAnimatedWordLayer(
                text = word.text.trim(),
                graphemes = graphemes,
                positionMs = positionMs,
                fontSize = fontSize,
                fontWeight = fontWeight,
                color = Color.White.copy(alpha = darkAlpha),
                emphasize = emphasize,
                chunkStartTimeMs = chunkStartTimeMs,
                profile = profile,
                glyphIndexOffset = glyphIndexOffset,
                glyphCount = glyphCount,
                drawGlow = false,
                isBackground = isBackground,
                floatReleaseProgress = floatReleaseProgress,
            )
            AmllAnimatedWordLayer(
                text = word.text.trim(),
                graphemes = graphemes,
                positionMs = positionMs,
                fontSize = fontSize,
                fontWeight = fontWeight,
                color = Color.White.copy(
                    alpha = (brightAlpha - darkAlpha).coerceAtLeast(0f),
                ),
                emphasize = emphasize,
                chunkStartTimeMs = chunkStartTimeMs,
                profile = profile,
                glyphIndexOffset = glyphIndexOffset,
                glyphCount = glyphCount,
                drawGlow = true,
                isBackground = isBackground,
                floatReleaseProgress = floatReleaseProgress,
                modifier = Modifier
                    .graphicsLayer {
                        // AMLL switches an inactive line to SOLID rendering:
                        // the paused mask remains, but its bright layer,
                        // including the emphasis shadow, must release.
                        alpha = floatReleaseProgress
                        compositingStrategy = CompositingStrategy.Offscreen
                    }
                    .drawWithContent {
                        when {
                            highlightProgress <= 0f -> Unit
                            highlightProgress >= 1f -> drawContent()
                            else -> {
                                drawContent()
                                val canvasWidth = size.width
                                val canvasHeight = size.height
                                val boundaries = amllMaskBoundaries(
                                    progress = highlightProgress,
                                    width = canvasWidth,
                                    height = canvasHeight,
                                )
                                val stops = buildList {
                                    add(
                                        0f to Color.Black.copy(
                                            alpha = amllMaskAlphaAt(
                                                progress = highlightProgress,
                                                xFraction = 0f,
                                                width = canvasWidth,
                                                height = canvasHeight,
                                            ),
                                        ),
                                    )
                                    if (boundaries.brightEndFraction in 0f..1f) {
                                        add(boundaries.brightEndFraction to Color.Black)
                                    }
                                    if (boundaries.fadeEndFraction in 0f..1f) {
                                        add(boundaries.fadeEndFraction to Color.Transparent)
                                    }
                                    add(
                                        1f to Color.Black.copy(
                                            alpha = amllMaskAlphaAt(
                                                progress = highlightProgress,
                                                xFraction = 1f,
                                                width = canvasWidth,
                                                height = canvasHeight,
                                            ),
                                        ),
                                    )
                                }
                                drawRect(
                                    brush = Brush.horizontalGradient(
                                        *stops.toTypedArray(),
                                    ),
                                    blendMode = BlendMode.DstIn,
                                )
                            }
                        }
                    },
            )
        }

        if (reserveRomanSpace) {
            Text(
                text = word.romanText.ifBlank { " " },
                color = Color.White.copy(
                    alpha = when {
                        word.romanText.isBlank() -> 0f
                        else -> darkAlpha +
                            highlightProgress * (brightAlpha - darkAlpha)
                    },
                ),
                fontSize = (fontSize * 0.5f).sp,
                lineHeight = (fontSize * 0.5f).sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun AmllAnimatedWordLayer(
    text: String,
    graphemes: List<String>,
    positionMs: Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    floatReleaseProgress: Float,
    modifier: Modifier = Modifier,
) {
    if (emphasize) {
        AmllAnimatedGlyphRow(
            graphemes = graphemes,
            positionMs = positionMs,
            fontSize = fontSize,
            fontWeight = fontWeight,
            color = color,
            emphasize = true,
            chunkStartTimeMs = chunkStartTimeMs,
            profile = profile,
            glyphIndexOffset = glyphIndexOffset,
            glyphCount = glyphCount,
            drawGlow = drawGlow,
            isBackground = isBackground,
            floatReleaseProgress = floatReleaseProgress,
            modifier = modifier,
        )
    } else {
        Text(
            text = text,
            modifier = modifier,
            color = color,
            fontSize = fontSize.sp,
            lineHeight = (fontSize * 1.25f).sp,
            fontWeight = fontWeight,
            maxLines = 1,
        )
    }
}

@Composable
private fun AmllAnimatedGlyphRow(
    graphemes: List<String>,
    positionMs: Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndexOffset: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    floatReleaseProgress: Float,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.Bottom,
    ) {
        graphemes.forEachIndexed { index, grapheme ->
            AmllAnimatedCharacter(
                grapheme = grapheme,
                positionMs = positionMs,
                fontSize = fontSize,
                fontWeight = fontWeight,
                color = color,
                emphasize = emphasize,
                chunkStartTimeMs = chunkStartTimeMs,
                profile = profile,
                glyphIndex = glyphIndexOffset + index,
                glyphCount = glyphCount,
                drawGlow = drawGlow,
                isBackground = isBackground,
                floatReleaseProgress = floatReleaseProgress,
            )
        }
    }
}

@Composable
private fun AmllAnimatedCharacter(
    grapheme: String,
    positionMs: Float,
    fontSize: Float,
    fontWeight: FontWeight,
    color: Color,
    emphasize: Boolean,
    chunkStartTimeMs: Long,
    profile: AmllEmphasisProfile,
    glyphIndex: Int,
    glyphCount: Int,
    drawGlow: Boolean,
    isBackground: Boolean,
    floatReleaseProgress: Float,
) {
    val staggerMs = profile.durationMs.toFloat() / 2.5f / glyphCount
    val entryTimeMs = chunkStartTimeMs + staggerMs * glyphIndex
    val emphasisProgress =
        ((positionMs - entryTimeMs) / profile.durationMs).coerceIn(0f, 1f)
    val emphasis = if (emphasize) amllEmphasisEasing(emphasisProgress) else 0f
    val floatStartMs = entryTimeMs - 400f
    val floatProgress =
        ((positionMs - floatStartMs) / (profile.durationMs * 1.4f)).coerceIn(0f, 1f)
    val floatLift = if (emphasize) {
        sin(floatProgress * PI).toFloat() * if (isBackground) 2f else 1f
    } else {
        0f
    }
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSize.sp.toPx() }
    val centerOffset = glyphCount / 2f - glyphIndex
    val glowLevel = (emphasis * profile.blur).coerceIn(0f, 0.8f)
    val glowRadius = fontSizePx * minOf(0.3f, profile.blur * 0.3f) * emphasis

    Text(
        text = grapheme,
        color = color,
        fontSize = fontSize.sp,
        lineHeight = (fontSize * 1.25f).sp,
        fontWeight = fontWeight,
        maxLines = 1,
        style = TextStyle(
            shadow = Shadow(
                color = Color.White.copy(alpha = if (drawGlow) glowLevel else 0f),
                blurRadius = if (drawGlow) glowRadius else 0f,
            ),
        ),
        modifier = Modifier.graphicsLayer {
            val scale = 1f + emphasis * 0.1f * profile.amount
            scaleX = scale
            scaleY = scale
            translationX =
                -emphasis * 0.03f * profile.amount * centerOffset * fontSizePx
            translationY =
                -(
                    emphasis * 0.025f * profile.amount +
                        floatLift * 0.05f * floatReleaseProgress
                    ) * fontSizePx
            transformOrigin = TransformOrigin.Center
        },
    )
}

@Composable
internal fun rememberAmllMaskAlpha(target: Float): State<Float> {
    var previousTarget = remember { target }
    val durationMs = if (target > previousTarget) 70 else 300
    SideEffect { previousTarget = target }
    return animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = durationMs),
        label = "amllMaskAlpha",
    )
}
