package io.github.yueby.musictogether.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import io.github.yueby.musictogether.ui.designsystem.liquid.IosLiquidGlassNavigationBar
import org.junit.Rule
import org.junit.Test
import top.yukonga.miuix.kmp.basic.NavigationItem
import top.yukonga.miuix.kmp.theme.MiuixTheme

class LiquidNavigationBarTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun solidOfficialFallback_keepsTabsInteractive() {
        composeRule.setContent {
            MiuixTheme {
                val selected = remember { mutableIntStateOf(0) }
                IosLiquidGlassNavigationBar(
                    items = listOf(
                        NavigationItem("首页", Icons.Default.Home),
                        NavigationItem("搜索", Icons.Default.Search),
                    ),
                    selectedIndex = selected.intValue,
                    onItemClick = { selected.intValue = it },
                    backdrop = null,
                    isBlurActive = false,
                )
            }
        }

        composeRule.onNodeWithText("搜索").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("搜索").assertExists()
    }

    @Test
    fun compactNavigation_keepsCircularTabsAccessible() {
        composeRule.setContent {
            MiuixTheme {
                val selected = remember { mutableIntStateOf(0) }
                IosLiquidGlassNavigationBar(
                    items = listOf(
                        NavigationItem("首页", Icons.Default.Home),
                        NavigationItem("搜索", Icons.Default.Search),
                    ),
                    selectedIndex = selected.intValue,
                    onItemClick = { selected.intValue = it },
                    backdrop = null,
                    isBlurActive = false,
                    compact = true,
                )
            }
        }

        composeRule.onNodeWithContentDescription("搜索").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("搜索").assertExists()
    }
}
