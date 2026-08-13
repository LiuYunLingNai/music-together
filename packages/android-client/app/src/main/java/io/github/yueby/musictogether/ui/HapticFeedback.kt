package io.github.yueby.musictogether.ui

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext

@Volatile
private var hapticFeedbackEnabled = true

internal fun syncHapticFeedbackSetting(enabled: Boolean) {
    hapticFeedbackEnabled = enabled
}

internal fun Context.performClickHapticFeedback() {
    if (!hapticFeedbackEnabled) return
    val vibrator = getSystemService(Vibrator::class.java) ?: return
    if (!vibrator.hasVibrator()) return

    runCatching {
        val effect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
        } else {
            VibrationEffect.createOneShot(12L, 72)
        }
        vibrator.vibrate(effect)
    }
}

@Composable
internal fun HapticIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    IconButton(
        onClick = {
            context.performClickHapticFeedback()
            onClick()
        },
        modifier = modifier,
        enabled = enabled,
        content = content,
    )
}

@Composable
internal fun rememberHapticClick(onClick: () -> Unit): () -> Unit {
    val context = LocalContext.current
    return remember(context, onClick) {
        {
            context.performClickHapticFeedback()
            onClick()
        }
    }
}

@Composable
internal fun rememberHapticValueChange(onChange: (Boolean) -> Unit): (Boolean) -> Unit {
    val context = LocalContext.current
    return remember(context, onChange) {
        { value ->
            context.performClickHapticFeedback()
            onChange(value)
        }
    }
}
