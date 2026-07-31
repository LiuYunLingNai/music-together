package io.github.yueby.musictogether.ui.player

import android.animation.ValueAnimator
import android.content.Context
import android.os.PowerManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext

internal const val AmllPowerSavingFrameIntervalNanos = 33_333_333L

internal data class AmllMotionPolicy(
    val minimumFrameIntervalNanos: Long,
    val expensiveEffectsEnabled: Boolean,
)

internal fun amllMotionPolicy(
    animatorsEnabled: Boolean,
    powerSaveMode: Boolean,
): AmllMotionPolicy {
    val expensiveEffectsEnabled = animatorsEnabled && !powerSaveMode
    return AmllMotionPolicy(
        minimumFrameIntervalNanos =
            if (expensiveEffectsEnabled) 0L else AmllPowerSavingFrameIntervalNanos,
        expensiveEffectsEnabled = expensiveEffectsEnabled,
    )
}

internal val LocalAmllExpensiveEffectsEnabled = staticCompositionLocalOf { true }

@Composable
internal fun rememberAmllMotionPolicy(): AmllMotionPolicy {
    val context = LocalContext.current
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return amllMotionPolicy(
        animatorsEnabled = ValueAnimator.areAnimatorsEnabled(),
        powerSaveMode = powerManager.isPowerSaveMode,
    )
}
