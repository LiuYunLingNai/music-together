package io.github.yueby.musictogether.share

internal data class ShareRect(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f
}

internal data class ShareCardMetrics(
    val width: Int,
    val height: Int,
    val padding: Float,
    val coverRect: ShareRect,
    val infoLeft: Float,
    val infoRight: Float,
    val qrCardRect: ShareRect,
    val qrCodeRect: ShareRect,
    val cornerRadius: Float,
    val coverCornerRadius: Float,
) {
    companion object {
        const val WIDTH = 1240
        const val HEIGHT = 700
        private const val PADDING = 72f
        private const val COLUMN_GAP = 56f
        private const val QR_CARD_SIZE = 452f
        private const val QR_CODE_INSET = 46f
        private const val COVER_SIZE = 236f

        fun create(width: Int = WIDTH, height: Int = HEIGHT): ShareCardMetrics {
            val qrCardTop = (height - QR_CARD_SIZE) / 2f
            val qrCardLeft = width - PADDING - QR_CARD_SIZE
            val qrCard = ShareRect(qrCardLeft, qrCardTop, qrCardLeft + QR_CARD_SIZE, qrCardTop + QR_CARD_SIZE)
            val qrCode = ShareRect(
                left = qrCard.left + QR_CODE_INSET,
                top = qrCard.top + QR_CODE_INSET,
                right = qrCard.right - QR_CODE_INSET,
                bottom = qrCard.bottom - QR_CODE_INSET - QR_CODE_INSET / 2f,
            )
            val cover = ShareRect(PADDING, PADDING + 24f, PADDING + COVER_SIZE, PADDING + 24f + COVER_SIZE)
            return ShareCardMetrics(
                width = width,
                height = height,
                padding = PADDING,
                coverRect = cover,
                infoLeft = PADDING,
                infoRight = qrCardLeft - COLUMN_GAP,
                qrCardRect = qrCard,
                qrCodeRect = qrCode,
                cornerRadius = 44f,
                coverCornerRadius = 28f,
            )
        }
    }
}

internal fun qrModuleSize(matrixSize: Int, availablePx: Float): Float {
    if (matrixSize <= 0 || availablePx <= 0f) return 0f
    val raw = availablePx / matrixSize
    val rounded = raw.toInt().toFloat()
    return if (rounded >= 1f) rounded else raw
}
