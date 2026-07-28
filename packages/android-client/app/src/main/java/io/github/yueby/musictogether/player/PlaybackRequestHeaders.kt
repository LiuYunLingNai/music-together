package io.github.yueby.musictogether.player

internal object PlaybackRequestHeaders {
    const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"

    fun forHost(host: String): Map<String, String> = when {
        host.matchesDomain("bilivideo.com") || host.matchesDomain("bilivideo.cn") -> browserHeaders("https://www.bilibili.com/")
        host.matchesDomain("qqmusic.qq.com") || host.matchesDomain("music.qq.com") -> browserHeaders("https://y.qq.com/")
        host.matchesDomain("music.126.net") || host.matchesDomain("music.163.com") -> browserHeaders("https://music.163.com/")
        host.matchesDomain("kugou.com") -> browserHeaders("https://www.kugou.com/")
        else -> emptyMap()
    }

    private fun browserHeaders(referer: String) = mapOf(
        "Referer" to referer,
        "Origin" to referer.removeSuffix("/"),
        "User-Agent" to USER_AGENT,
    )

    private fun String.matchesDomain(domain: String): Boolean = this == domain || endsWith(".$domain")
}
