package io.github.yueby.musictogether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.scale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.model.RoomMember
import io.github.yueby.musictogether.model.RoomState

@Composable
internal fun MembersPane(
    room: RoomState,
    userId: String?,
    canManageRoles: Boolean,
    onSetRole: (String, String) -> Unit,
) {
    val roleOrder = mapOf("owner" to 0, "admin" to 1, "member" to 2)
    val members = room.members.sortedWith(
        compareByDescending<RoomMember> { it.isServerAdmin }
            .thenBy { roleOrder[it.role] ?: 9 }
            .thenByDescending { it.isOnline },
    )
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Groups, contentDescription = null, Modifier.size(20.dp))
            Text(
                "房间成员 (${room.users.size}/${members.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(members, key = { it.id }) { member ->
                val canEditRole = canManageRoles &&
                    !member.isServerAdmin &&
                    member.role != "owner" &&
                    member.id != userId
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MemberAvatar(member, room.creatorId)
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    member.nickname,
                                    modifier = Modifier.weight(1f, fill = false),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    fontSize = 14.sp,
                                )
                                if (member.id == userId) {
                                    Text(
                                        "你",
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(MaterialTheme.colorScheme.secondaryContainer)
                                            .padding(horizontal = 7.dp, vertical = 2.dp),
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                            MemberClients(member)
                        }
                        if (canEditRole) {
                            AdminRoleSwitch(
                                member = member,
                                onCheckedChange = { enabled ->
                                    onSetRole(member.id, if (enabled) "admin" else "member")
                                },
                            )
                        } else {
                            MemberRoleLabel(member)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MemberAvatar(member: RoomMember, creatorId: String) {
    Box(Modifier.size(40.dp)) {
        if (member.avatarUrl.isNullOrBlank()) {
            Icon(
                Icons.Default.AccountCircle,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                tint = if (member.id == creatorId) Color(0xFFFFC857) else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            AsyncImage(
                model = member.avatarUrl,
                contentDescription = "${member.nickname}头像",
                modifier = Modifier.fillMaxSize().clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(9.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface)
                .padding(1.5.dp)
                .clip(CircleShape)
                .background(if (member.isOnline) Color(0xFF22C55E) else MaterialTheme.colorScheme.outline),
        )
    }
}

@Composable
private fun MemberClients(member: RoomMember) {
    val clients = member.clients.ifEmpty { listOfNotNull(member.client) }
    if (clients.isEmpty()) return
    Column(
        modifier = Modifier.padding(top = 2.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        if (!member.isOnline) {
            Text("上次使用：", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        }
        clients.forEach { client ->
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    imageVector = when (client.kind) {
                        "android" -> Icons.Default.Smartphone
                        "windows", "desktop" -> Icons.Default.Computer
                        else -> Icons.Default.Language
                    },
                    contentDescription = null,
                    modifier = Modifier.padding(top = 1.dp).size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = buildString {
                        append(client.label)
                        client.count?.takeIf { it > 1 }?.let { append(" ×$it") }
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }
        }
    }
}

@Composable
private fun MemberRoleLabel(member: RoomMember) {
    val label = if (member.isServerAdmin) "服务器管理员" else roleLabel(member.role)
    Text(
        label,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 12.sp,
        maxLines = 1,
    )
}

@Composable
private fun AdminRoleSwitch(member: RoomMember, onCheckedChange: (Boolean) -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "管理员",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
        )
        Switch(
            checked = member.role == "admin",
            onCheckedChange = onCheckedChange,
            modifier = Modifier
                .scale(0.82f)
                .semantics {
                    contentDescription = "设置${member.nickname}为管理员"
                },
        )
    }
}
