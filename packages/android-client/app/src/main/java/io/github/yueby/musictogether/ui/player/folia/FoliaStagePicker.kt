package io.github.yueby.musictogether.ui.player.folia

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.composables.icons.lucide.Check
import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.X
import io.github.yueby.musictogether.ui.player.IconButton
import io.github.yueby.musictogether.ui.player.Surface
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Text

@Composable
internal fun FoliaStagePicker(selected: FoliaStageMode, onSelect: (FoliaStageMode) -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color(0xF2080A0F))
            .windowInsetsPadding(WindowInsets.safeDrawing).padding(24.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Folia 舞台", color = Color.White, fontSize = 24.sp)
                Text("20 种歌词舞台", color = Color.White.copy(alpha = 0.72f), fontSize = 14.sp)
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                Icon(Lucide.X, "关闭舞台选择", tint = Color.White)
            }
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(144.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(top = 24.dp),
        ) {
            items(FoliaStageMode.entries, key = { it.id }) { mode ->
                Surface(
                    color = if (mode == selected) Color(0xFF393D47) else Color(0xFF20232B),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(Modifier.fillMaxWidth().clickable { onSelect(mode) }.padding(16.dp)) {
                        Column {
                            Text(mode.label, color = Color.White, fontSize = 18.sp)
                            Text(if (mode == selected) "当前舞台" else "点按切换", color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
                        }
                        if (mode == selected) Icon(Lucide.Check, "当前舞台", Modifier.align(Alignment.CenterEnd).size(20.dp), tint = Color.White)
                    }
                }
            }
        }
    }
}
