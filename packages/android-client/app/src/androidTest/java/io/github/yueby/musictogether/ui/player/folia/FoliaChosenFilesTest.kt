package io.github.yueby.musictogether.ui.player.folia

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import android.webkit.WebChromeClient
import org.junit.Test

class FoliaChosenFilesTest {
    @Test
    fun imageChooserUsesOpenableDocumentsAndPreservesMultipleSelection() {
        val params = object : WebChromeClient.FileChooserParams() {
            override fun getMode() = MODE_OPEN_MULTIPLE
            override fun getAcceptTypes() = arrayOf("image/*")
            override fun isCaptureEnabled() = false
            override fun getTitle(): CharSequence? = null
            override fun getFilenameHint(): String? = null
            override fun createIntent() = Intent(Intent.ACTION_GET_CONTENT)
        }
        val intent = foliaFileChooserIntent(params)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertEquals("image/*", intent.type)
        assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
    }

    @Test
    fun photoPickerClipDataSurvivesWithoutIntentData() {
        val first = Uri.parse("content://media/picker/images/1")
        val second = Uri.parse("content://media/picker/images/2")
        val data = Intent().apply {
            clipData = ClipData.newRawUri("images", first).apply { addItem(ClipData.Item(second)) }
        }
        assertArrayEquals(arrayOf(first, second), foliaChosenFiles(Activity.RESULT_OK, data))
        assertNull(foliaChosenFiles(Activity.RESULT_CANCELED, data))
    }
}
