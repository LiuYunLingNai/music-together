package io.github.yueby.musictogether.ui.player.folia

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean

/** ADB audit host: keeps the real offline WebView available to the device test runner. */
class FoliaSettingsDeviceTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun settingsAuditSession() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("foliaSettingsAudit") == "true")
        val ready = AtomicBoolean(false)
        composeRule.setContent {
            val pending = remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
            val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                pending.value?.onReceiveValue(foliaChosenFiles(result.resultCode, result.data))
                pending.value = null
            }
            AndroidView(
                factory = { context -> FoliaWebView(context, onChooseFiles = { params, callback ->
                    pending.value?.onReceiveValue(null)
                    pending.value = callback
                    chooser.launch(foliaFileChooserIntent(params))
                }) { event, _ -> if (event == "ready") ready.set(true) } },
                onRelease = { it.release() },
                modifier = Modifier.fillMaxSize(),
            )
        }
        composeRule.waitUntil(timeoutMillis = 30_000) { ready.get() }
        val stopFile = InstrumentationRegistry.getInstrumentation().targetContext.filesDir.resolve("folia-audit-stop")
        stopFile.delete()
        val deadline = System.nanoTime() + 2_700_000_000_000L
        while (!stopFile.exists() && System.nanoTime() < deadline) Thread.sleep(250)
        stopFile.delete()
    }
}
