package io.github.yueby.musictogether.ui.player.folia

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
internal fun ImmersiveWindow(enabled: Boolean) {
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(view, lifecycle, enabled) {
        val window = view.context.findActivity()?.window
        if (!enabled || window == null) return@DisposableEffect onDispose { }
        val controller = WindowCompat.getInsetsController(window, view)
        val originalBehavior = controller.systemBarsBehavior
        val insets = ViewCompat.getRootWindowInsets(view)
        val statusVisible = insets?.isVisible(WindowInsetsCompat.Type.statusBars()) ?: true
        val navigationVisible = insets?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true
        val keptAwake = window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
        var applied = false
        fun restore() {
            if (!applied) return
            controller.systemBarsBehavior = originalBehavior
            if (statusVisible) controller.show(WindowInsetsCompat.Type.statusBars())
            else controller.hide(WindowInsetsCompat.Type.statusBars())
            if (navigationVisible) controller.show(WindowInsetsCompat.Type.navigationBars())
            else controller.hide(WindowInsetsCompat.Type.navigationBars())
            if (!keptAwake) window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            applied = false
        }
        fun update() {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                applied = true
            } else restore()
        }
        val observer = LifecycleEventObserver { _, _ -> update() }
        lifecycle.addObserver(observer)
        update()
        onDispose {
            lifecycle.removeObserver(observer)
            restore()
        }
    }
}
