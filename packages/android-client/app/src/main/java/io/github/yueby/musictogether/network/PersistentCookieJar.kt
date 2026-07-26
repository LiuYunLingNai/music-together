package io.github.yueby.musictogether.network

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

class PersistentCookieJar(context: Context) : CookieJar {
    private val preferences = context.getSharedPreferences("network_cookies", Context.MODE_PRIVATE)
    private val cookies = mutableListOf<Cookie>()

    init {
        restore()
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies += cookie
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val removed = cookies.removeAll { it.expiresAt <= now }
        if (removed) persist()
        return cookies.filter { it.matches(url) }
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
                if (cookie.expiresAt > System.currentTimeMillis()) cookies += cookie
            }
        }
    }

    private fun persist() {
        val array = JSONArray()
        cookies.forEach { cookie ->
            array.put(JSONObject().apply {
                put("name", cookie.name)
                put("value", cookie.value)
                put("domain", cookie.domain)
                put("path", cookie.path)
                put("expiresAt", cookie.expiresAt)
                put("secure", cookie.secure)
                put("httpOnly", cookie.httpOnly)
                put("hostOnly", cookie.hostOnly)
            })
        }
        preferences.edit().putString("cookies", array.toString()).apply()
    }
}
