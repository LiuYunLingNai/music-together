package io.github.yueby.musictogether.updates

import android.app.Application
import io.github.yueby.musictogether.BuildConfig
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.network.AppUpdateInstaller
import io.github.yueby.musictogether.network.AppUpdateService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Owns update checking, download verification, and the downloaded APK
 * lifecycle. The ViewModel remains the public UI facade and supplies state
 * mutation callbacks.
 */
internal class AppUpdateCoordinator(
    private val application: Application,
    private val service: AppUpdateService,
    private val scope: CoroutineScope,
    private val state: () -> AppState,
    private val updateState: ((AppState) -> AppState) -> Unit,
    private val showNotice: (String) -> Unit,
) {
    private var downloadedApk: java.io.File? = null

    fun check(silent: Boolean, releasesApi: String) {
        if (state().updateChecking || state().updateDownloading) return
        updateState { it.copy(updateChecking = true, updateError = null) }
        scope.launch {
            runCatching {
                service.latestRelease(releasesApi, BuildConfig.VERSION_NAME, BuildConfig.FLAVOR)
            }.onSuccess { update ->
                val keepDownloadedApk =
                    update?.versionName == state().updateInfo?.versionName &&
                        downloadedApk?.exists() == true
                if (!keepDownloadedApk) downloadedApk = null
                updateState {
                    it.copy(
                        updateChecking = false,
                        updateInfo = update,
                        updateReadyToInstall = keepDownloadedApk,
                        updateError = null,
                    )
                }
                if (update != null && !silent) showNotice("发现新版本 v${update.versionName}")
            }.onFailure { error ->
                AppLogger.warn("Update", "release check failed: ${error.message}")
                updateState {
                    it.copy(
                        updateChecking = false,
                        updateError = if (silent) null else "更新检查失败，请检查网络后重试",
                    )
                }
            }
        }
    }

    fun download() {
        val update = state().updateInfo ?: return
        val source = state().updateSource
        if (state().updateDownloading) return
        downloadedApk = null
        updateState {
            it.copy(
                updateDownloading = true,
                updateDownloadProgress = 0,
                updateReadyToInstall = false,
                updateError = null,
            )
        }
        scope.launch {
            runCatching {
                service.downloadAndVerify(application, update, source) { progress ->
                    updateState { it.copy(updateDownloadProgress = progress) }
                }
            }.onSuccess { apk ->
                downloadedApk = apk
                updateState {
                    it.copy(
                        updateDownloading = false,
                        updateDownloadProgress = 100,
                        updateReadyToInstall = true,
                    )
                }
                showNotice("更新包已下载并完成校验")
            }.onFailure { error ->
                AppLogger.warn("Update", "download failed: ${error.message}")
                updateState {
                    it.copy(
                        updateDownloading = false,
                        updateDownloadProgress = null,
                        updateError = "更新下载或校验失败，请切换下载源后重试",
                    )
                }
            }
        }
    }

    fun install() {
        val apk = downloadedApk?.takeIf { it.exists() } ?: run {
            updateState { it.copy(updateError = "更新包不可用，请重新下载") }
            return
        }
        if (!AppUpdateInstaller.install(application, apk)) {
            showNotice("请允许本应用安装未知来源应用后，再次点击安装")
        }
    }
}
