package io.github.yueby.musictogether.ui.player

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import kotlin.math.abs

@Composable
internal fun rememberAmllPreviewGroupIndex(
    listItems: List<AmllListItem>,
    listState: LazyListState,
    manualBrowseActive: Boolean,
    alignPosition: Float,
    alignToTop: Boolean,
): State<Int> = remember(
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
                    val item = listItems.getOrNull(visibleItem.index)
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

@Composable
internal fun rememberAmllPreviewGeometry(
    listItems: List<AmllListItem>,
    listState: LazyListState,
    previewGroupIndex: Int,
    measuredMainLyricGeometry: IndexedValue<AmllPrimaryTextGeometry>?,
    measuredLyricGroupBounds: IndexedValue<androidx.compose.ui.geometry.Rect>?,
): State<AmllPreviewGeometry?> = remember(
    listItems,
    listState,
    previewGroupIndex,
    measuredMainLyricGeometry,
    measuredLyricGroupBounds,
) {
    derivedStateOf {
        val visibleItem = listState.layoutInfo.visibleItemsInfo.firstOrNull { info ->
            listItems.getOrNull(info.index)?.groupIndex == previewGroupIndex
        }
        val lineItem = visibleItem?.let { listItems.getOrNull(it.index) }
        if (lineItem == null) {
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
            } else {
                null
            }
        }
    }
}
