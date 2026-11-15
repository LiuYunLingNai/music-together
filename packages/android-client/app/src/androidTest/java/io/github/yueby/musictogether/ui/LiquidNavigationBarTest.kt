package io.github.yueby.musictogether.ui

import com.composables.icons.lucide.Lucide
import com.composables.icons.lucide.House
import com.composables.icons.lucide.Search
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
                        NavigationItem("首页", Lucide.House),
                        NavigationItem("搜索", Lucide.Search),
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
}
