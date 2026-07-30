package io.github.yueby.musictogether.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yueby.musictogether.model.VoteState

@Composable
internal fun PlayerChatButton(
    unreadCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    iconAlpha: Float = 0.72f,
    enabled: Boolean = true,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
    ) {
        Box(Modifier.size(30.dp)) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = "打开聊天",
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(22.dp)
                    .graphicsLayer { alpha = iconAlpha },
                tint = Color.White,
            )
            if (unreadCount > 0) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .height(15.dp)
                        .widthIn(min = 15.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.92f))
                        .padding(horizontal = 3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (unreadCount > 99) "99+" else unreadCount.toString(),
                        color = Color.Black,
                        fontSize = 7.sp,
                        lineHeight = 7.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
internal fun AnimatedPlayerVotePrompt(
    vote: VoteState?,
    userId: String?,
    onCastVote: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = vote != null,
        modifier = modifier,
        enter = fadeIn(tween(180)) + slideInVertically(tween(220)) { it / 3 },
        exit = fadeOut(tween(150)) + slideOutVertically(tween(180)) { it / 3 },
    ) {
        vote?.let {
            PlayerVotePrompt(
                vote = it,
                userId = userId,
                onCastVote = onCastVote,
            )
        }
    }
}

@Composable
internal fun PlayerVotePrompt(
    vote: VoteState,
    userId: String?,
    onCastVote: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasVoted = userId?.let(vote.votes::containsKey) == true
    val approveCount = vote.votes.values.count { it }
    val rejectCount = vote.votes.values.count { !it }

    Surface(
        modifier = modifier.widthIn(max = 420.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color.Black.copy(alpha = 0.76f),
        tonalElevation = 0.dp,
        shadowElevation = 12.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "${vote.initiatorNickname} 发起“${playerVoteActionLabel(vote.action)}”投票",
                    color = Color.White.copy(alpha = 0.92f),
                    fontSize = 13.sp,
                    lineHeight = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = buildString {
                        vote.payload["trackTitle"]?.takeIf { it.isNotBlank() }?.let {
                            append(it)
                            append(" · ")
                        }
                        append("赞成 $approveCount · 反对 $rejectCount · 需要 ${vote.requiredVotes} 票")
                    },
                    color = Color.White.copy(alpha = 0.54f),
                    fontSize = 10.sp,
                    lineHeight = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (hasVoted) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = Color.White.copy(alpha = 0.76f),
                    )
                    Text(
                        if (vote.initiatorId == userId) "已发起" else "已投票",
                        color = Color.White.copy(alpha = 0.68f),
                        fontSize = 11.sp,
                    )
                }
            } else {
                TextButton(onClick = { onCastVote(false) }) {
                    Text("反对", color = Color.White.copy(alpha = 0.68f), fontSize = 12.sp)
                }
                FilledTonalButton(onClick = { onCastVote(true) }) {
                    Text("同意", fontSize = 12.sp)
                }
            }
        }
    }
}
