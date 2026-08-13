package io.github.yueby.musictogether.ui

import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

@OptIn(ExperimentalMaterial3Api::class)
class PopupCompatibilityTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun miuixOverlayDropdown_opensWithoutMissingNavigationDispatcher() {
        composeRule.setContent {
            MiuixTheme {
                OverlayDropdownPreference(
                    title = "主题模式",
                    items = listOf("跟随系统", "浅色", "深色"),
                    selectedIndex = 0,
                    onSelectedIndexChange = {},
                )
            }
        }

        composeRule.onNodeWithText("主题模式").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("浅色").assertExists()
    }

    @Test
    fun miuixWindowDropdown_rendersAboveWindowSheets() {
        composeRule.setContent {
            MiuixTheme {
                WindowDropdownPreference(
                    title = "音乐平台",
                    items = listOf("网易云", "QQ 音乐", "酷狗"),
                    selectedIndex = 0,
                    onSelectedIndexChange = {},
                )
            }
        }

        composeRule.onNodeWithText("音乐平台").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("QQ 音乐").assertExists()
    }

    @Test
    fun materialExposedDropdown_usesRuntimeCompatibleAbi() {
        composeRule.setContent {
            MaterialTheme {
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it },
                ) {
                    OutlinedTextField(
                        value = "高品质",
                        onValueChange = {},
                        readOnly = true,
                        modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false },
                    ) {
                        Text("无损")
                    }
                }
            }
        }

        composeRule.onNodeWithText("高品质").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("无损").assertExists()
    }
}
