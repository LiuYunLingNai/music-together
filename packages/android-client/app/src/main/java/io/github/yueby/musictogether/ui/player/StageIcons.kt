package io.github.yueby.musictogether.ui.player

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Lucide glyphs drawn with `fill="currentColor"`, as the web transport buttons do. */
private fun lucideFilled(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        paths.forEach {
            addPath(
                pathData = addPathNodes(it),
                fill = SolidColor(Color.Black),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

internal val StagePlayIcon by lazy { lucideFilled("StagePlay", "M6 3L20 12L6 21Z") }

internal val StagePauseIcon by lazy {
    lucideFilled(
        "StagePause",
        "M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
        "M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    )
}

internal val StageSkipBackIcon by lazy { lucideFilled("StageSkipBack", "M19 20L9 12L19 4Z", "M5 19V5") }

internal val StageSkipForwardIcon by lazy { lucideFilled("StageSkipForward", "M5 4L15 12L5 20Z", "M19 5V19") }

internal val StageHeartFilledIcon by lazy {
    lucideFilled(
        "StageHeartFilled",
        "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
    )
}
