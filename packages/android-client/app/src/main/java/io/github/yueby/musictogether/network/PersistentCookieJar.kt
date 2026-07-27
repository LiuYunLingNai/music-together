package io.github.yueby.musictogether.network

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

class PersistentCookieJar(context: Context) : CookieJar {
    private data class StoredCookie(val cookie: Cookie, var origin: String)

    private val preferences = context.getSharedPreferences("network_cookies", Context.MODE_PRIVATE)
    private val cookies = mutableListOf<StoredCookie>()

    init {
        restore()
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val origin = url.originKey()
        for (cookie in cookies) {
            this.cookies.removeAll {
                it.cookie.name == cookie.name &&
                    it.cookie.domain == cookie.domain &&
                    it.cookie.path == cookie.path &&
                    (it.origin == origin || it.origin.isBlank())
            }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies += StoredCookie(cookie, origin)
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        var changed = cookies.removeAll { it.cookie.expiresAt <= now }
        val origin = url.originKey()
        cookies.filter { it.origin.isBlank() && it.cookie.matches(url) }.forEach {
            it.origin = origin
            changed = true
        }
        if (changed) persist()
        return cookies.filter { it.origin == origin && it.cookie.matches(url) }.map(StoredCookie::cookie)
    }

    private fun restore() {
        val raw = preferences.getString("cookies", null) ?: return
        runCatching {
            val array = JSONArray(raw)
            repeat(array.length()) { index ->
                val item = array.getJSONObject(index)
                val builder = Cookie.Builder()
                    .name(item.getString("name"))
                    .value(item.getString("value"))
                    .path(item.optString("path", "/"))
                    .expiresAt(item.getLong("expiresAt"))
                if (item.optBoolean("hostOnly")) builder.hostOnlyDomain(item.getString("domain"))
                else builder.domain(item.getString("domain"))
                if (item.optBoolean("secure")) builder.secure()
                if (item.optBoolean("httpOnly")) builder.httpOnly()
                val cookie = builder.build()
                if (cookie.expiresAt > System.currentTimeMillis()) {
                    cookies += StoredCookie(cookie, item.optString("origin"))
                }
            }
        }
    }

    private fun persist() {
        val array = JSONArray()
        cookies.forEach { stored ->
            val cookie = stored.cookie
            array.put(JSONObject().apply {
                put("name", cookie.name)
                put("value", cookie.value)
                put("domain", cookie.domain)
                put("path", cookie.path)
                put("expiresAt", cookie.expiresAt)
                put("secure", cookie.secure)
                put("httpOnly", cookie.httpOnly)
                put("hostOnly", cookie.hostOnly)
                put("origin", stored.origin)
            })
        }
        preferences.edit().putString("cookies", array.toString()).apply()
    }

    private fun HttpUrl.originKey(): String = "${scheme}://${host}:${port}"
}
