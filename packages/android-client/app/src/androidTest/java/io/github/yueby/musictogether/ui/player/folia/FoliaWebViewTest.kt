package io.github.yueby.musictogether.ui.player.folia

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewFeature
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import io.github.yueby.musictogether.model.LyricsState
import io.github.yueby.musictogether.model.LyricLine
import io.github.yueby.musictogether.model.LyricWord
import io.github.yueby.musictogether.model.PlayerDisplaySettings
import io.github.yueby.musictogether.model.Track
import org.json.JSONObject

class FoliaWebViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun localStageLoadsAndReleasesItsMessageChannel() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        val ready = AtomicBoolean(false)
        val tapped = AtomicBoolean(false)
        val released = AtomicBoolean(false)
        val shown = mutableStateOf(true)
        var stage: FoliaWebView? = null
        composeRule.setContent {
            if (shown.value) {
                AndroidView(
                    factory = { context ->
                        FoliaWebView(context) { event, _ ->
                            if (event == "ready") ready.set(true)
                            if (event == "tap") tapped.set(true)
                        }.also { stage = it }
                    },
                    onRelease = { it.release(); released.set(true) },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        composeRule.waitUntil(timeoutMillis = 20_000) { ready.get() }
        composeRule.runOnIdle {
            stage!!.selectMode("still")
            stage.evaluateJavascript("document.dispatchEvent(new MouseEvent('click'))", null)
        }
        composeRule.waitUntil(timeoutMillis = 5_000) { tapped.get() }
        composeRule.runOnIdle { shown.value = false }
        composeRule.waitUntil(timeoutMillis = 5_000) { released.get() }
        assertTrue(released.get())
    }

    @Test
    fun nativeDocumentAndFrameRenderVisibleLyrics() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        val ready = AtomicBoolean(false)
        val rendered = AtomicBoolean(false)
        val snapshot = AtomicReference<String>("")
        var stage: FoliaWebView? = null
        composeRule.setContent {
            AndroidView(
                factory = { context ->
                    FoliaWebView(context) { event, _ ->
                        if (event == "ready") ready.set(true)
                    }.also { stage = it }
                },
                onRelease = { it.release() },
                modifier = Modifier.fillMaxSize(),
            )
        }
        composeRule.waitUntil(timeoutMillis = 20_000) { ready.get() }
        composeRule.runOnIdle {
            val track = Track("test", "测试曲目", listOf("测试歌手"), "", 30.0, "", "netease", "1", "1")
            val line = LyricLine(
                words = listOf(LyricWord("安卓舞台歌词可见", 0L, 30_000L)),
                startTimeMs = 0L,
                endTimeMs = 30_000L,
            )
            stage!!.updateDocument(foliaDocument(track, LyricsState(trackId = "test", lines = listOf(line)), PlayerDisplaySettings()).toString())
            stage.selectMode("still")
            stage.updateFrame(JSONObject().put("position", 2.0).put("lineIndex", 0).put("paused", true).put("chromeHidden", true).toString())
        }
        composeRule.waitUntil(timeoutMillis = 10_000) {
            composeRule.runOnUiThread {
                stage!!.evaluateJavascript(
                    "JSON.stringify({text:document.body.innerText,width:document.getElementById('root').clientWidth,height:document.getElementById('root').clientHeight})",
                ) { result ->
                    snapshot.set(result)
                    val json = JSONObject(org.json.JSONTokener(result).nextValue() as String)
                    rendered.set(
                        json.getString("text").contains("安卓舞台歌词可见") &&
                            json.getInt("width") > 0 && json.getInt("height") > 0,
                    )
                }
            }
            rendered.get()
        }
        assertTrue(snapshot.get(), rendered.get())
        rendered.set(false)
        composeRule.runOnIdle { stage!!.selectMode("sonnet") }
        composeRule.waitUntil(timeoutMillis = 15_000) {
            composeRule.runOnUiThread {
                stage!!.evaluateJavascript(
                    "JSON.stringify({height:document.getElementById('root').clientHeight,canvas:Array.from(document.querySelectorAll('canvas')).some(c=>c.width>0&&c.height>0&&c.getBoundingClientRect().height>0)})",
                ) { result ->
                    snapshot.set(result)
                    val json = JSONObject(org.json.JSONTokener(result).nextValue() as String)
                    rendered.set(json.getInt("height") > 0 && json.getBoolean("canvas"))
                }
            }
            rendered.get()
        }
        assertTrue(snapshot.get(), rendered.get())
    }

    @Test
    fun lyricStagesKeepLongLinesInsideMeasuredViewport() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        val ready = AtomicBoolean(false)
        val fitted = AtomicBoolean(false)
        val snapshot = AtomicReference<String>("")
        var stage: FoliaWebView? = null
        composeRule.setContent {
            AndroidView(
                factory = { context ->
                    FoliaWebView(context) { event, _ -> if (event == "ready") ready.set(true) }.also { stage = it }
                },
                onRelease = { it.release() },
                modifier = Modifier.fillMaxSize(),
            )
        }
        composeRule.waitUntil(timeoutMillis = 20_000) { ready.get() }
        composeRule.runOnIdle {
            val track = Track("long", "长句", listOf("歌手"), "", 60.0, "", "netease", "1", "1")
            val text = "也许时间是一种解药也是我现在正服下的毒药爱你让我重新编织脑海中温暖的记忆"
            val line = LyricLine(
                words = text.mapIndexed { index, char -> LyricWord(char.toString(), index * 200L, (index + 1) * 200L) },
                startTimeMs = 0,
                endTimeMs = text.length * 200L,
            )
            stage!!.updateDocument(foliaDocument(track, LyricsState(trackId = "long", lines = listOf(line)), PlayerDisplaySettings(lyricFontScale = 1.3f)).toString())
            stage.updateFrame(JSONObject().put("position", 4.0).put("lineIndex", 0).put("paused", true).put("chromeHidden", true).toString())
        }
        for ((index, mode) in listOf("classic", "partita", "tilt").withIndex()) {
            fitted.set(false)
            var sample = 0
            composeRule.runOnIdle { stage!!.selectMode(mode) }
            composeRule.waitUntil(timeoutMillis = 10_000) {
                composeRule.runOnUiThread {
                    // Deliver advancing samples after the lazy renderer has mounted,
                    // as the native playback clock does in the real player.
                    stage!!.updateFrame(JSONObject().put("position", 4.01 + index * 0.1 + sample++ / 10_000.0).put("lineIndex", 0).put("paused", false).put("chromeHidden", true).toString())
                    stage.evaluateJavascript(
                        "JSON.stringify((()=>{const fit=document.querySelector('[data-folia-lyric-fit]');if(!fit)return {ok:false};const area=fit.parentElement.getBoundingClientRect(),line=fit.getBoundingClientRect();const glyphs=Array.from(fit.querySelectorAll('span')).filter(e=>{if(e.childElementCount||!e.textContent.trim())return false;let opacity=1;for(let n=e;n&&n!==fit.parentElement;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return opacity>0.1});return {ok:area.height>innerHeight*0.65&&area.top>0&&line.height>0&&line.top>=area.top-2&&line.bottom<=area.bottom+2&&line.left>=area.left-2&&line.right<=area.right+2&&glyphs.length>0&&glyphs.every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),top:line.top,bottom:line.bottom,height:area.height};})())",
                    ) { result ->
                        snapshot.set(result)
                        val json = JSONObject(org.json.JSONTokener(result).nextValue() as String)
                        fitted.set(json.getBoolean("ok"))
                    }
                }
                fitted.get()
            }
            assertTrue("$mode: ${snapshot.get()}", fitted.get())
        }
    }
}
