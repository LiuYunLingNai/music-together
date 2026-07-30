package io.github.yueby.musictogether.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DoorBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AdminRoom
import io.github.yueby.musictogether.model.AdminUser
import io.github.yueby.musictogether.model.AppState

private enum class SettingsSection { Account, App, Admin }
private enum class AdminSection { Users, Rooms, Proxy }

@Composable
fun AccountSettingsPane(state: AppState, viewModel: MusicTogetherViewModel) {
    var section by remember { mutableStateOf(SettingsSection.Account) }
    val isAdmin = state.accountProfile?.role == "admin"

    LaunchedEffect(isAdmin) {
        if (!isAdmin && section == SettingsSection.Admin) section = SettingsSection.Account
    }
    LaunchedEffect(section, isAdmin) {
        if (section == SettingsSection.Admin && isAdmin) viewModel.loadAdminData()
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilterChip(
                selected = section == SettingsSection.Account,
                onClick = { section = SettingsSection.Account },
                label = { Text("账号") },
                leadingIcon = { Icon(Icons.Default.AccountCircle, null, Modifier.size(18.dp)) },
            )
            FilterChip(
                selected = section == SettingsSection.App,
                onClick = { section = SettingsSection.App },
                label = { Text("应用") },
                leadingIcon = { Icon(Icons.Default.SystemUpdate, null, Modifier.size(18.dp)) },
            )
            if (isAdmin) {
                FilterChip(
                    selected = section == SettingsSection.Admin,
                    onClick = { section = SettingsSection.Admin },
                    label = { Text("服务器管理") },
                    leadingIcon = { Icon(Icons.Default.Shield, null, Modifier.size(18.dp)) },
                )
            }
        }
        HorizontalDivider()
        when (section) {
            SettingsSection.Account -> AccountSection(state, viewModel)
            SettingsSection.App -> AppUpdatePane(state, viewModel)
            SettingsSection.Admin -> AdminSection(state, viewModel)
        }
    }
}

@Composable
private fun AccountSection(state: AppState, viewModel: MusicTogetherViewModel) {
    val profile = state.accountProfile
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let(viewModel::uploadAvatar)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    if (profile?.avatarUrl != null) {
                        AsyncImage(
                            model = profile.avatarUrl,
                            contentDescription = "头像",
                            modifier = Modifier.size(64.dp).clip(CircleShape),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Icon(
                            Icons.Default.AccountCircle,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (profile != null) {
                        IconButton(
                            onClick = { avatarPicker.launch("image/*") },
                            enabled = !state.accountBusy,
                            modifier = Modifier.align(Alignment.BottomEnd).size(30.dp),
                        ) {
                            Icon(Icons.Default.CameraAlt, "上传头像", Modifier.size(18.dp))
                        }
                    }
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(profile?.nickname ?: "访客身份", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        profile?.id ?: "保存昵称后生成账号 ID",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (profile?.role == "admin") AssistChip(onClick = {}, label = { Text("服务器管理员") })
                }
                if (state.accountLoading || state.accountBusy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        }

        item {
            SettingsTitle("个人资料")
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.nickname,
                    onValueChange = viewModel::updateNickname,
                    modifier = Modifier.weight(1f),
                    label = { Text("昵称") },
                    singleLine = true,
                )
                Button(
                    onClick = viewModel::saveNickname,
                    enabled = !state.accountBusy && state.nickname.isNotBlank() && state.nickname.trim() != profile?.nickname,
                ) { Text("保存") }
            }
            if (profile == null) {
                Text(
                    "首次保存昵称后会创建正式账号，随后可设置账号 ID、头像和密码。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        if (profile != null) {
            item {
                AccountIdEditor(state, viewModel)
            }
        }

        item {
            AccountAccessControls(state, viewModel)
        }
    }
}

@Composable
private fun AccountIdEditor(state: AppState, viewModel: MusicTogetherViewModel) {
    val profile = state.accountProfile ?: return
    var accountId by remember(profile.id) { mutableStateOf(profile.id) }
    var currentPassword by remember(profile.id) { mutableStateOf("") }
    val normalized = accountId.trim().lowercase()
    val valid = Regex("^[a-z0-9_-]{3,32}$").matches(normalized)

    SettingsTitle("账号 ID")
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = accountId,
        onValueChange = { accountId = it.lowercase().take(32) },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("账号 ID") },
        supportingText = { Text("3-32 位小写字母、数字、_ 或 -") },
        singleLine = true,
    )
    if (profile.hasPassword) {
        OutlinedTextField(
            value = currentPassword,
            onValueChange = { currentPassword = it.take(128) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            label = { Text("当前密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
    }
    Button(
        onClick = { viewModel.updateAccountId(normalized, currentPassword.takeIf { it.isNotBlank() }) },
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        enabled = !state.accountBusy && valid && normalized != profile.id && (!profile.hasPassword || currentPassword.isNotBlank()),
    ) { Text("保存账号 ID") }
}

@Composable
private fun AccountAccessControls(state: AppState, viewModel: MusicTogetherViewModel) {
    val profile = state.accountProfile
    var newPassword by remember(profile?.id) { mutableStateOf("") }
    var loginId by remember { mutableStateOf("") }
    var loginPassword by remember { mutableStateOf("") }

    SettingsTitle("账号安全")
    Spacer(Modifier.height(10.dp))
    if (profile?.hasPassword == true) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.primary)
            Text("当前账号已启用密码", Modifier.weight(1f))
            OutlinedButton(onClick = viewModel::logoutIdentity, enabled = !state.accountBusy) {
                Icon(Icons.AutoMirrored.Filled.Logout, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("退出")
            }
        }
        return
    }

    if (profile != null) {
        OutlinedTextField(
            value = newPassword,
            onValueChange = { newPassword = it.take(128) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("设置密码（至少 8 位）") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
        Button(
            onClick = { viewModel.setInitialPassword(newPassword) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            enabled = !state.accountBusy && newPassword.length >= 8,
        ) { Text("保护当前账号") }
        HorizontalDivider(Modifier.padding(vertical = 18.dp))
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.AutoMirrored.Filled.Login, null)
        Text("登录已有账号", fontWeight = FontWeight.SemiBold)
    }
    OutlinedTextField(
        value = loginId,
        onValueChange = { loginId = it.take(128) },
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        label = { Text("账号 ID") },
        singleLine = true,
    )
    OutlinedTextField(
        value = loginPassword,
        onValueChange = { loginPassword = it.take(128) },
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        label = { Text("密码") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
    )
    Button(
        onClick = { viewModel.loginIdentity(loginId, loginPassword) },
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        enabled = !state.accountBusy && loginId.isNotBlank() && loginPassword.isNotBlank(),
    ) { Text("登录") }
}

@Composable
private fun AdminSection(state: AppState, viewModel: MusicTogetherViewModel) {
    var section by remember { mutableStateOf(AdminSection.Users) }
    var confirmation by remember { mutableStateOf<AdminConfirmation?>(null) }
    val passwords = remember { mutableStateMapOf<String, String>() }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${state.adminUsers.size} 个账号 · ${state.adminRooms.size} 个活跃房间", Modifier.weight(1f))
            IconButton(onClick = viewModel::loadAdminData, enabled = !state.adminLoading) {
                if (state.adminLoading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Icon(Icons.Default.Refresh, "刷新")
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(selected = section == AdminSection.Users, onClick = { section = AdminSection.Users }, label = { Text("账号") })
            FilterChip(selected = section == AdminSection.Rooms, onClick = { section = AdminSection.Rooms }, label = { Text("房间") })
            FilterChip(selected = section == AdminSection.Proxy, onClick = { section = AdminSection.Proxy }, label = { Text("代理") })
        }
        when (section) {
            AdminSection.Users -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!state.adminLoading && state.adminUsers.isEmpty()) {
                    item {
                        Text(
                            "暂无账号",
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(state.adminUsers, key = { it.id }) { user ->
                    AdminUserCard(
                        user = user,
                        currentUserId = state.accountProfile?.id,
                        password = passwords[user.id].orEmpty(),
                        working = state.adminWorkingId == user.id,
                        onPasswordChange = { passwords[user.id] = it.take(128) },
                        onResetPassword = { viewModel.resetAdminPassword(user.id, passwords[user.id].orEmpty()) },
                        onDelete = { confirmation = AdminConfirmation.DeleteUser(user) },
                    )
                }
            }
            AdminSection.Rooms -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!state.adminLoading && state.adminRooms.isEmpty()) {
                    item {
                        Text(
                            "暂无活跃房间",
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(state.adminRooms, key = { it.id }) { room ->
                    AdminRoomCard(
                        room = room,
                        working = state.adminWorkingId == room.id,
                        onDissolve = { confirmation = AdminConfirmation.DissolveRoom(room) },
                    )
                }
            }
            AdminSection.Proxy -> AudioProxyPolicySection(state, viewModel)
        }
    }

    confirmation?.let { action ->
        AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text(if (action is AdminConfirmation.DeleteUser) "删除账号" else "解散房间") },
            text = { Text(action.message) },
            confirmButton = {
                Button(onClick = {
                    when (action) {
                        is AdminConfirmation.DeleteUser -> viewModel.deleteAdminUser(action.user.id)
                        is AdminConfirmation.DissolveRoom -> viewModel.dissolveAdminRoom(action.room.id)
                    }
                    confirmation = null
                }) { Text("确认") }
            },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun AudioProxyPolicySection(state: AppState, viewModel: MusicTogetherViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            SettingsTitle("音频传输")
        }
        item {
            Text(
                "B站始终通过服务器代理播放，Cookie 仅保留在服务端。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            AudioProxyPolicyRow(
                label = "酷狗强制服务器代理",
                description = "关闭后明文资源优先直连，加密资源仍由服务器代理解密",
                checked = state.audioProxyPolicy.kugouForceProxy,
                enabled = state.adminWorkingId == null,
                onCheckedChange = viewModel::updateKugouForceProxy,
            )
        }
    }
}

@Composable
private fun AudioProxyPolicyRow(
    label: String,
    description: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, fontWeight = FontWeight.Medium)
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

@Composable
private fun AdminUserCard(
    user: AdminUser,
    currentUserId: String?,
    password: String,
    working: Boolean,
    onPasswordChange: (String) -> Unit,
    onResetPassword: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(user.nickname.ifBlank { "未设置昵称" }, fontWeight = FontWeight.SemiBold)
                    Text(user.id, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
                if (user.role == "admin") AssistChip(onClick = {}, label = { Text("管理员") })
                IconButton(onClick = onDelete, enabled = !working && user.id != currentUserId) {
                    Icon(Icons.Default.Delete, "删除账号", tint = MaterialTheme.colorScheme.error)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = password,
                    onValueChange = onPasswordChange,
                    modifier = Modifier.weight(1f),
                    label = { Text("新密码（至少 8 位）") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                OutlinedButton(onClick = onResetPassword, enabled = !working && password.length >= 8) { Text("重置") }
            }
        }
    }
}

@Composable
private fun AdminRoomCard(room: AdminRoom, working: Boolean, onDissolve: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.DoorBack, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(room.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${room.id} · ${room.userCount} 人 · ${if (room.hidden) "隐藏" else "公开"} · " +
                        "${if (room.permanent) "永久" else "临时"}${room.currentTrackTitle?.let { " · $it" }.orEmpty()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            OutlinedButton(onClick = onDissolve, enabled = !working) { Text("解散") }
        }
    }
}

@Composable
private fun SettingsTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}

private sealed interface AdminConfirmation {
    val message: String

    data class DeleteUser(val user: AdminUser) : AdminConfirmation {
        override val message = "确定删除账号 ${user.id}？该操作会同时移除其持久化资料。"
    }

    data class DissolveRoom(val room: AdminRoom) : AdminConfirmation {
        override val message = "确定解散房间 ${room.name}（${room.id}）？"
    }
}
