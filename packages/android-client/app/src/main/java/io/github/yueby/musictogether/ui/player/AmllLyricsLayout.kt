package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import io.github.yueby.musictogether.lyrics.AmllLyricGroup
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

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

internal data class AmllListItem(
    val trackId: String?,
    val groupIndex: Int,
    val group: AmllLyricGroup,
) {
    val stableKey = "line:$trackId:${group.main.startTimeMs}:$groupIndex"
}

internal fun buildAmllListItems(
    trackId: String?,
    groups: List<AmllLyricGroup>,
): List<AmllListItem> = groups.mapIndexed { index, group ->
    AmllListItem(trackId = trackId, groupIndex = index, group = group)
}

internal suspend fun LazyListState.scrollFocusedItemToAdaptiveAnchor(
    index: Int,
    animate: Boolean,
    alignPosition: Float,
    alignToTop: Boolean,
    scrollMotion: Animatable<Float, AnimationVector1D>,
    stiffness: Float = AmllSpringStiffness,
    dampingRatio: Float = AmllPositionDampingRatio,
): Boolean {
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
): Boolean = previousGroupIndex < 0 || timelineDiscontinuity

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

internal fun amllGroupTargetAlpha(active: Boolean): Float =
    if (active) AmllActiveGroupAlpha else 1f

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
    focusedListIndex.coerceIn(0, itemCount - 1)
} else {
    0
}

internal fun <T> amllMeasurementForGroup(
    measurement: IndexedValue<T>?,
    groupIndex: Int,
): T? = measurement?.takeIf { it.index == groupIndex }?.value
