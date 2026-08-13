package io.github.yueby.musictogether.ui.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card as MaterialCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.yueby.musictogether.model.UiStyle
import top.yukonga.miuix.kmp.basic.Button as MiuixButton
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.basic.TextButton as MiuixTextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun UiStyleSelector(
    selectedStyle: UiStyle,
    onStyleSelected: (UiStyle) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (LocalUiStyle.current) {
        UiStyle.Material3 -> MaterialCard(modifier = modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                MaterialText(
                    text = "界面风格",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MaterialText(
                    text = "可随时切换，播放和房间连接不会中断",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    UiStyle.entries.forEachIndexed { index, style ->
                        SegmentedButton(
                            selected = selectedStyle == style,
                            onClick = { onStyleSelected(style) },
                            shape = SegmentedButtonDefaults.itemShape(index, UiStyle.entries.size),
                            label = { MaterialText(style.label) },
                        )
                    }
                }
            }
        }

        UiStyle.Miuix -> MiuixCard(modifier = modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp)) {
                MiuixText(
                    text = "界面风格",
                    style = MiuixTheme.textStyles.title3,
                    fontWeight = FontWeight.SemiBold,
                )
                MiuixText(
                    text = "可随时切换，播放和房间连接不会中断",
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    style = MiuixTheme.textStyles.footnote1,
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    UiStyle.entries.forEach { style ->
                        if (selectedStyle == style) {
                            MiuixButton(
                                onClick = { onStyleSelected(style) },
                                modifier = Modifier.weight(1f),
                            ) {
                                MiuixText(style.label)
                            }
                        } else {
                            MiuixTextButton(
                                text = style.label,
                                onClick = { onStyleSelected(style) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
    }
}

private val UiStyle.label: String
    get() = when (this) {
        UiStyle.Material3 -> "Material 3"
        UiStyle.Miuix -> "MIUIX"
    }
