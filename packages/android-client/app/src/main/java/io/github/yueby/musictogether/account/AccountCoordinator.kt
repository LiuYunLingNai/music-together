package io.github.yueby.musictogether.account

import android.app.Application
import android.net.Uri
import android.util.Base64
import io.github.yueby.musictogether.logging.AppLogger
import io.github.yueby.musictogether.model.AccountProfile
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.AudioProxyPolicy
import io.github.yueby.musictogether.network.MusicTogetherApi
import io.github.yueby.musictogether.network.ServerAddress
import io.github.yueby.musictogether.settings.AppPreferences
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Coordinates identity, profile, avatar, and administrator workflows. It owns
 * no socket lifecycle; reconnect and identity-bound cleanup remain explicit
 * callbacks to the application coordinator.
 */
internal class AccountCoordinator(
    private val application: Application,
    private val api: MusicTogetherApi,
    private val preferences: AppPreferences,
    private val scope: CoroutineScope,
    private val state: () -> AppState,
    private val updateState: ((AppState) -> AppState) -> Unit,
    private val activeServer: () -> ServerAddress?,
    private val desiredRoomId: () -> String?,
    private val clearIdentityBoundState: (ServerAddress) -> Unit,
    private val reconnect: (ServerAddress) -> Unit,
    private val prepareLogout: () -> Unit,
    private val applyAudioProxyPolicy: (AudioProxyPolicy) -> Unit,
    private val showNotice: (String) -> Unit,
    private val setError: (String) -> Unit,
) {
    fun refresh(showError: Boolean = true) {
        val server = activeServer() ?: return
        if (state().accountLoading) return
        updateState { it.copy(accountLoading = true) }
        scope.launch {
            runCatching { api.currentProfile(server) }
                .onSuccess(::applyProfile)
                .onFailure {
                    AppLogger.warn("Account", "profile refresh failed: ${it.message}")
                    updateState { state -> state.copy(accountLoading = false) }
                    if (showError) setError(it.message ?: "账号资料加载失败")
                }
        }
    }

    fun saveNickname() {
        val server = activeServer() ?: return setError("请先连接服务端")
        val nickname = state().nickname.trim()
        if (nickname.isBlank()) return setError("昵称不能为空")
        runAccountAction("昵称已保存到服务器") { api.updateNickname(server, nickname) }
    }

    fun uploadAvatar(uri: Uri) {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (state().accountProfile == null) return setError("请先保存昵称后再上传头像")
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching {
                val resolver = application.contentResolver
                val mime = resolver.getType(uri)?.lowercase()
                if (mime !in setOf("image/png", "image/jpeg", "image/jpg", "image/webp")) {
                    error("仅支持 PNG、JPEG 和 WebP 图片")
                }
                val bytes = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use(::readAvatarBytes) ?: error("无法读取图片")
                }
                val data = "data:$mime;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
                api.uploadAvatar(server, data)
            }.onSuccess {
                applyProfile(it)
                showNotice("头像已保存到服务器")
            }.onFailure {
                updateState { state -> state.copy(accountBusy = false) }
                setError(it.message ?: "头像上传失败")
            }
        }
    }

    fun setInitialPassword(password: String) {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (password.length < 8) return setError("密码至少需要 8 个字符")
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching {
                api.setInitialPassword(server, password)
                api.currentProfile(server) ?: error("请先设置昵称")
            }.onSuccess {
                applyProfile(it)
                showNotice("账号密码已设置")
            }.onFailure {
                updateState { state -> state.copy(accountBusy = false) }
                setError(it.message ?: "密码设置失败")
            }
        }
    }

    fun updateAccountId(accountId: String, currentPassword: String?) {
        val server = activeServer() ?: return setError("请先连接服务端")
        val normalized = accountId.trim().lowercase()
        if (!ACCOUNT_ID_PATTERN.matches(normalized)) {
            return setError("账号 ID 需为 3-32 位小写字母、数字、下划线或连字符")
        }
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching { api.updateAccountId(server, normalized, currentPassword) }
                .onSuccess { profile ->
                    desiredRoomId()?.let { preferences.clearRoomRejoin(server.displayUrl, it) }
                    applyProfile(profile)
                    showNotice("账号 ID 已修改")
                    reconnect(server)
                }
                .onFailure {
                    updateState { state -> state.copy(accountBusy = false) }
                    setError(it.message ?: "账号 ID 修改失败")
                }
        }
    }

    fun login(accountId: String, password: String) {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (accountId.isBlank() || password.isBlank()) return setError("请输入账号 ID 和密码")
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching {
                api.recoverIdentity(server, accountId.trim(), password)
                api.currentProfile(server) ?: error("账号资料恢复失败")
            }.onSuccess {
                clearIdentityBoundState(server)
                applyProfile(it)
                showNotice("账号登录成功")
                reconnect(server)
            }.onFailure {
                updateState { state -> state.copy(accountBusy = false) }
                setError(it.message ?: "账号登录失败")
            }
        }
    }

    fun logout() {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching { api.logoutIdentity(server) }
                .onSuccess { temporaryId ->
                    prepareLogout()
                    clearIdentityBoundState(server)
                    preferences.clearNickname()
                    updateState {
                        it.copy(
                            userId = temporaryId,
                            nickname = "",
                            accountProfile = null,
                            accountBusy = false,
                            room = null,
                        )
                    }
                    showNotice("已退出账号并切换到访客身份")
                    reconnect(server)
                }
                .onFailure {
                    updateState { state -> state.copy(accountBusy = false) }
                    setError(it.message ?: "退出账号失败")
                }
        }
    }

    fun loadAdminData() {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (state().accountProfile?.role != "admin") return setError("需要服务器管理员权限")
        if (state().adminLoading) return
        updateState { it.copy(adminLoading = true) }
        scope.launch {
            runCatching {
                Triple(api.adminUsers(server), api.adminRooms(server), api.adminAudioProxyPolicy(server))
            }
                .onSuccess { (users, rooms, policy) ->
                    updateState {
                        it.copy(
                            adminUsers = users,
                            adminRooms = rooms,
                            audioProxyPolicy = policy,
                            adminLoading = false,
                        )
                    }
                }
                .onFailure {
                    updateState { state -> state.copy(adminLoading = false) }
                    setError(it.message ?: "管理员数据加载失败")
                }
        }
    }

    fun deleteAdminUser(userId: String) =
        runAdminAction(userId, "账号已删除") { server -> api.deleteAdminUser(server, userId) }

    fun resetAdminPassword(userId: String, password: String) {
        if (password.length < 8) return setError("密码至少需要 8 个字符")
        runAdminAction(userId, "密码已重置") { server ->
            api.resetAdminPassword(server, userId, password)
        }
    }

    fun dissolveAdminRoom(roomId: String) =
        runAdminAction(roomId, "房间已解散") { server -> api.dissolveAdminRoom(server, roomId) }

    fun updateKugouForceProxy(enabled: Boolean) = updateAudioProxyPolicy(enabled)

    fun applyProfile(profile: AccountProfile?) {
        if (profile == null) {
            updateState { it.copy(accountProfile = null, accountLoading = false, accountBusy = false) }
            return
        }
        val server = activeServer()
        val resolved = profile.copy(
            avatarUrl = server?.let { api.resolveResource(it, profile.avatarUrl) } ?: profile.avatarUrl,
        )
        preferences.setNickname(resolved.nickname)
        val previousId = state().userId
        updateState { current ->
            current.copy(
                userId = resolved.id,
                nickname = resolved.nickname,
                accountProfile = resolved,
                accountLoading = false,
                accountBusy = false,
                room = current.room?.let { room ->
                    room.copy(
                        users = room.users.map { user ->
                            if (user.id == resolved.id || user.id == previousId) {
                                user.copy(
                                    id = resolved.id,
                                    nickname = resolved.nickname,
                                    avatarUrl = resolved.avatarUrl,
                                )
                            } else {
                                user
                            }
                        },
                    )
                },
            )
        }
    }

    fun withPersistedNickname(action: () -> Unit) {
        val server = activeServer()
        val nickname = state().nickname.trim()
        if (server == null || state().accountProfile?.nickname == nickname) {
            action()
            return
        }
        scope.launch {
            runCatching { api.updateNickname(server, nickname) }
                .onSuccess(::applyProfile)
                .onFailure {
                    AppLogger.warn(
                        "Account",
                        "nickname sync before room action failed: ${it.message}",
                    )
                }
            action()
        }
    }

    private fun runAccountAction(
        successMessage: String,
        action: suspend () -> AccountProfile,
    ) {
        if (state().accountBusy) return
        updateState { it.copy(accountBusy = true) }
        scope.launch {
            runCatching { action() }
                .onSuccess {
                    applyProfile(it)
                    showNotice(successMessage)
                }
                .onFailure {
                    updateState { state -> state.copy(accountBusy = false) }
                    setError(it.message ?: "账号操作失败")
                }
        }
    }

    private fun runAdminAction(
        targetId: String,
        successMessage: String,
        action: suspend (ServerAddress) -> Unit,
    ) {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (state().accountProfile?.role != "admin") return setError("需要服务器管理员权限")
        if (state().adminWorkingId != null) return
        updateState { it.copy(adminWorkingId = targetId) }
        scope.launch {
            runCatching { action(server) }
                .onSuccess {
                    updateState { state -> state.copy(adminWorkingId = null) }
                    showNotice(successMessage)
                    loadAdminData()
                }
                .onFailure {
                    updateState { state -> state.copy(adminWorkingId = null) }
                    setError(it.message ?: "管理员操作失败")
                }
        }
    }

    private fun updateAudioProxyPolicy(enabled: Boolean) {
        val server = activeServer() ?: return setError("请先连接服务端")
        if (state().accountProfile?.role != "admin") return setError("需要服务器管理员权限")
        if (state().adminWorkingId != null) return
        val targetId = "audio-proxy-policy:kugou"
        updateState { it.copy(adminWorkingId = targetId) }
        scope.launch {
            runCatching { api.updateAdminAudioProxyPolicy(server, enabled) }
                .onSuccess { policy ->
                    updateState { it.copy(adminWorkingId = null) }
                    applyAudioProxyPolicy(policy)
                    showNotice("音频代理策略已更新")
                }
                .onFailure {
                    updateState { it.copy(adminWorkingId = null) }
                    setError(it.message ?: "音频代理策略更新失败")
                }
        }
    }

    private fun readAvatarBytes(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            if (output.size() > MAX_AVATAR_BYTES) error("头像不能超过 5MB")
        }
        return output.toByteArray()
    }

    private companion object {
        val ACCOUNT_ID_PATTERN = Regex("^[a-z0-9_-]{3,32}$")
        const val MAX_AVATAR_BYTES = 5 * 1024 * 1024
    }
}
