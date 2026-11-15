package io.github.yueby.musictogether.ui.player.folia

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.net.Uri
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.yueby.musictogether.BuildConfig
import org.json.JSONObject
import java.io.ByteArrayInputStream

internal const val FoliaOrigin = "https://appassets.androidplatform.net"
private const val FoliaPage = FoliaOrigin + "/assets/folia/index.html"

// This view is created by Compose, never inflated from an XML layout.
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
internal class FoliaWebView(
    context: Context,
    private val onChooseFiles: (WebChromeClient.FileChooserParams, ValueCallback<Array<Uri>>) -> Unit = { _, callback -> callback.onReceiveValue(null) },
    private val onEvent: (String, Double?) -> Unit,
) : WebView(context) {
    private var ready = false
    private var documentPayload: String? = null
    private var modeId = "sonnet"
    private var sentMode: String? = null
    private val loader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        // JIZURA uses a root-relative iframe URL in the original renderer.
        .addPathHandler("/jizura/", WebViewAssetLoader.PathHandler { path ->
            runCatching {
                val type = if (path.endsWith(".html")) "text/html" else "text/javascript"
                WebResourceResponse(type, "UTF-8", context.assets.open("folia/jizura/" + path))
            }.getOrNull()
        })
        .build()

    init {
        if (BuildConfig.DEBUG) setWebContentsDebuggingEnabled(true)
        setBackgroundColor(android.graphics.Color.rgb(8, 10, 15))
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        // WebChromeClient receives only user-selected document URIs; Chromium
        // needs content access to read those files for the original upload UI.
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = true
        // HTTP cover images remain supported alongside HTTPS server images.
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                onChooseFiles(params, callback)
                return true
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host == "appassets.androidplatform.net") {
                    return loader.shouldInterceptRequest(request.url) ?: WebResourceResponse(
                        "text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)),
                    )
                }
                return null
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // The original Text PV renderer navigates a local child iframe.
                // Main-frame and external navigations never replace the trusted host.
                return request.isForMainFrame || request.url.scheme != "https" ||
                    request.url.host != "appassets.androidplatform.net"
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { ready = false; sentMode = null }
            override fun onPageFinished(view: WebView, url: String?) { updateViewportSize() }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "MusicTogetherStage", setOf(FoliaOrigin)) {
                _, message, _, isMainFrame, _ ->
                if (!isMainFrame) return@addWebMessageListener
                val payload = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                val event = payload.optString("event")
                if (event == "ready") {
                    ready = true
                    updateViewportSize()
                    documentPayload?.let { evaluateJavascript("window.FoliaStage.document(" + it + ")", null) }
                    selectMode(modeId)
                }
                if (event in setOf("ready", "tap", "error", "seek", "editorSeek", "play", "pause", "settingsOpen", "settingsClose")) {
                    val position = payload.optDouble("position", Double.NaN).takeIf { it.isFinite() && it >= 0.0 }
                    onEvent(event, position)
                }
            }
            loadUrl(FoliaPage)
        } else onEvent("unsupported", null)
    }

    fun updateDocument(payload: String) {
        if (payload == documentPayload) return
        documentPayload = payload
        if (ready) evaluateJavascript("window.FoliaStage.document(" + payload + ")", null)
    }

    fun selectMode(id: String) {
        modeId = id
        if (!ready || sentMode == id) return
        sentMode = id
        evaluateJavascript("window.FoliaStage.mode(" + JSONObject.quote(id) + ")", null)
    }

    fun updateFrame(payload: String) {
        if (ready) evaluateJavascript("window.FoliaStage.frame(" + payload + ")", null)
    }

    fun showSettings(open: Boolean) {
        if (ready) evaluateJavascript("window.FoliaStage.settings($open)", null)
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        if (ready) updateViewportSize()
    }

    private fun updateViewportSize() {
        val density = resources.displayMetrics.density
        val cssWidth = width / density
        val cssHeight = height / density
        evaluateJavascript("window.FoliaStage?.resizeViewport($cssWidth,$cssHeight)", null)
    }

    fun release() {
        ready = false
        stopLoading()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(this, "MusicTogetherStage")
        }
        loadUrl("about:blank")
        removeAllViews()
        destroy()
    }
}
