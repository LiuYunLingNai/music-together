package io.github.yueby.musictogether.ui.player

import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp

@Immutable
internal data class AmllLineTypography(
    val mainFontSize: Float,
    val translationFontSize: Float,
    val romanFontSize: Float,
    val backgroundFontSize: Float,
    val horizontalContentPadding: Dp,
    val duetInset: Dp,
    val backgroundGap: Dp,
)

@Immutable
internal data class AmllLineMotion(
    val positionSpringStiffness: Float,
    val positionSpringDampingRatio: Float,
)
