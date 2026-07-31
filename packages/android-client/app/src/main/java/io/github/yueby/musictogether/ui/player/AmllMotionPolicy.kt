package io.github.yueby.musictogether.ui.player

import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext

// Keep a small tolerance below exact display periods so 60/120 Hz rounding
// never accidentally turns the intended 60/30 fps caps into 30/20 fps.
internal const val AmllNormalFrameIntervalNanos = 16_000_000L
internal const val AmllPowerSavingFrameIntervalNanos = 33_000_000L

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
            if (expensiveEffectsEnabled) {
                AmllNormalFrameIntervalNanos
            } else {
                AmllPowerSavingFrameIntervalNanos
            },
        expensiveEffectsEnabled = expensiveEffectsEnabled,
    )
}

internal val LocalAmllExpensiveEffectsEnabled = staticCompositionLocalOf { true }

@Composable
internal fun rememberAmllMotionPolicy(): AmllMotionPolicy {
    val context = LocalContext.current
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    var powerSaveMode by remember(powerManager) {
        mutableStateOf(powerManager.isPowerSaveMode)
    }
    DisposableEffect(context, powerManager) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                powerSaveMode = powerManager.isPowerSaveMode
            }
        }
        context.registerReceiver(
            receiver,
            IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED),
        )
        onDispose { context.unregisterReceiver(receiver) }
    }
    return amllMotionPolicy(
        animatorsEnabled = ValueAnimator.areAnimatorsEnabled(),
        powerSaveMode = powerSaveMode,
    )
}
