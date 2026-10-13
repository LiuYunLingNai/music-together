package io.github.yueby.musictogether.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.WindowDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

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
    fun miuixOverlayDropdown_selectionUpdatesState() {
        var selected by mutableStateOf(0)
        composeRule.setContent {
            MiuixTheme {
                OverlayDropdownPreference(
                    title = "下载源",
                    items = listOf("GitHub", "ghfast.top"),
                    selectedIndex = selected,
                    onSelectedIndexChange = { selected = it },
                )
            }
        }

        composeRule.onNodeWithText("下载源").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("ghfast.top").performClick()
        composeRule.waitForIdle()
        assertEquals(1, selected)
    }
}
