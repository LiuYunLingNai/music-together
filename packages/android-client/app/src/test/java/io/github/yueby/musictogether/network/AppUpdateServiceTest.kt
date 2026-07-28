package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.UpdateDownloadSource
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test

class AppUpdateServiceTest {
    private val service = AppUpdateService(OkHttpClient())

    @Test
    fun usesGhfastAsPrefixForGitHubReleaseAssets() {
        val githubUrl = "https://github.com/LiuYunLingNai/music-together/releases/download/v1.9.1/music-together-v1.9.1.apk"

        assertEquals(
            "https://ghfast.top/https://github.com/LiuYunLingNai/music-together/releases/download/v1.9.1/music-together-v1.9.1.apk",
            service.run { UpdateDownloadSource.Ghfast.resolveAssetUrl(githubUrl) },
        )
    }

    @Test
    fun preservesDirectGitHubReleaseAssets() {
        val githubUrl = "https://github.com/LiuYunLingNai/music-together/releases/download/v1.9.1/music-together-v1.9.1.apk"

        assertEquals(githubUrl, service.run { UpdateDownloadSource.GitHub.resolveAssetUrl(githubUrl) })
    }

    @Test
    fun selectsTheVivoReleaseAssetForTheVivoFlavor() {
        assertEquals("music-together-vivo-2.0.0.apk", service.apkAssetName("2.0.0", "vivo"))
    }

    @Test
    fun selectsTheStandardReleaseAssetForOtherFlavors() {
        assertEquals("music-together-v2.0.0.apk", service.apkAssetName("2.0.0", "standard"))
    }
}
