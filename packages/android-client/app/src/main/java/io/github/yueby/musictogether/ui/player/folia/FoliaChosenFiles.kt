package io.github.yueby.musictogether.ui.player.folia

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.WebChromeClient

internal fun foliaFileChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
    val types = params.acceptTypes.filter { it.contains('/') && !it.startsWith('.') }.distinct()
    // Older WebViews cannot reliably consume Media Photo Picker URI grants.
    // DocumentsUI returns openable content URIs for images and font files alike.
    return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = types.singleOrNull() ?: "*/*"
        if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

internal fun foliaChosenFiles(resultCode: Int, data: Intent?): Array<Uri>? {
    if (resultCode != Activity.RESULT_OK || data == null) return null
    // Android Photo Picker can return even one selected image only in ClipData.
    // FileChooserParams.parseResult on older WebViews reads Intent.data alone.
    val selected = data.clipData?.let { clips ->
        (0 until clips.itemCount).mapNotNull { clips.getItemAt(it).uri }.distinct()
    }.orEmpty()
    return selected.takeIf { it.isNotEmpty() }?.toTypedArray()
        ?: WebChromeClient.FileChooserParams.parseResult(resultCode, data)
}
