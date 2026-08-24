package io.github.yueby.musictogether.share

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

internal class QrCodeMatrix(val size: Int, private val cells: BooleanArray) {
    fun isDark(x: Int, y: Int): Boolean {
        if (x < 0 || y < 0 || x >= size || y >= size) return false
        return cells[y * size + x]
    }
}

internal object QrCodeEncoder {
    private const val QUIET_ZONE_MODULES = 1

    fun encode(content: String): QrCodeMatrix? {
        if (content.isBlank()) return null
        val hints = mapOf(
            EncodeHintType.CHARACTER_SET to "UTF-8",
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to QUIET_ZONE_MODULES,
        )
        val matrix = runCatching {
            QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, 0, 0, hints)
        }.getOrNull() ?: return null
        val size = minOf(matrix.width, matrix.height)
        if (size <= 0) return null
        val cells = BooleanArray(size * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                cells[y * size + x] = matrix.get(x, y)
            }
        }
        return QrCodeMatrix(size, cells)
    }
}
