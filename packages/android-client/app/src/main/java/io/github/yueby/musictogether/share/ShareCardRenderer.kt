package io.github.yueby.musictogether.share

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.palette.graphics.Palette
import kotlin.math.max
import kotlin.math.min

internal object ShareCardRenderer {
    private const val BLUR_SAMPLE_WIDTH = 48
    private const val BLUR_PASSES = 3
    private val FALLBACK_PRIMARY = Color.parseColor("#FF3F3A55")
    private val FALLBACK_SECONDARY = Color.parseColor("#FF14151C")

    fun render(content: ShareCardContent, cover: Bitmap?, qr: QrCodeMatrix?): Bitmap {
        val metrics = ShareCardMetrics.create()
        val bitmap = Bitmap.createBitmap(metrics.width, metrics.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val colors = extractColors(cover)
        drawBackground(canvas, metrics, cover, colors)
        drawInfoColumn(canvas, metrics, content, cover)
        drawQrCard(canvas, metrics, qr)
        return bitmap
    }

    private data class CardColors(val primary: Int, val secondary: Int)

    private fun extractColors(cover: Bitmap?): CardColors {
        if (cover == null) return CardColors(FALLBACK_PRIMARY, FALLBACK_SECONDARY)
        val palette = runCatching { Palette.from(cover).maximumColorCount(8).generate() }.getOrNull()
            ?: return CardColors(FALLBACK_PRIMARY, FALLBACK_SECONDARY)
        val primary = palette.vibrantSwatch?.rgb
            ?: palette.mutedSwatch?.rgb
            ?: palette.dominantSwatch?.rgb
            ?: FALLBACK_PRIMARY
        val secondary = palette.darkVibrantSwatch?.rgb
            ?: palette.darkMutedSwatch?.rgb
            ?: FALLBACK_SECONDARY
        return CardColors(primary, secondary)
    }

    private fun drawBackground(
        canvas: Canvas,
        metrics: ShareCardMetrics,
        cover: Bitmap?,
        colors: CardColors,
    ) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(
            0f,
            0f,
            metrics.width.toFloat(),
            metrics.height.toFloat(),
            darken(colors.primary, 0.55f),
            darken(colors.secondary, 0.75f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, metrics.width.toFloat(), metrics.height.toFloat(), paint)

        val blurred = cover?.let(::blurBitmap)
        if (blurred != null) {
            val coverPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                isFilterBitmap = true
                alpha = 150
            }
            val source = RectF(0f, 0f, blurred.width.toFloat(), blurred.height.toFloat())
            val target = RectF(0f, 0f, metrics.width.toFloat(), metrics.height.toFloat())
            val matrix = Matrix().apply { setRectToRect(source, target, Matrix.ScaleToFit.CENTER) }
            val scale = max(
                target.width() / source.width(),
                target.height() / source.height(),
            )
            matrix.setScale(scale, scale)
            matrix.postTranslate(
                (target.width() - source.width() * scale) / 2f,
                (target.height() - source.height() * scale) / 2f,
            )
            canvas.drawBitmap(blurred, matrix, coverPaint)
            blurred.recycle()
        }

        val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                metrics.coverRect.centerX,
                metrics.coverRect.centerY,
                metrics.width * 0.72f,
                intArrayOf(withAlpha(colors.primary, 92), Color.TRANSPARENT),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRect(0f, 0f, metrics.width.toFloat(), metrics.height.toFloat(), glowPaint)

        val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                0f,
                metrics.height.toFloat(),
                intArrayOf(Color.argb(60, 0, 0, 0), Color.argb(150, 0, 0, 0)),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRect(0f, 0f, metrics.width.toFloat(), metrics.height.toFloat(), scrimPaint)
    }

    private fun drawInfoColumn(
        canvas: Canvas,
        metrics: ShareCardMetrics,
        content: ShareCardContent,
        cover: Bitmap?,
    ) {
        val coverRect = RectF(
            metrics.coverRect.left,
            metrics.coverRect.top,
            metrics.coverRect.right,
            metrics.coverRect.bottom,
        )
        val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(110, 0, 0, 0)
        }
        canvas.drawRoundRect(
            RectF(coverRect.left + 6f, coverRect.top + 14f, coverRect.right + 6f, coverRect.bottom + 14f),
            metrics.coverCornerRadius,
            metrics.coverCornerRadius,
            shadowPaint,
        )
        if (cover != null) {
            val shaderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                isFilterBitmap = true
                shader = BitmapShader(cover, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
                    val scale = max(
                        coverRect.width() / cover.width,
                        coverRect.height() / cover.height,
                    )
                    setLocalMatrix(
                        Matrix().apply {
                            setScale(scale, scale)
                            postTranslate(
                                coverRect.left + (coverRect.width() - cover.width * scale) / 2f,
                                coverRect.top + (coverRect.height() - cover.height * scale) / 2f,
                            )
                        },
                    )
                }
            }
            canvas.drawRoundRect(coverRect, metrics.coverCornerRadius, metrics.coverCornerRadius, shaderPaint)
        } else {
            val placeholder = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(46, 255, 255, 255) }
            canvas.drawRoundRect(coverRect, metrics.coverCornerRadius, metrics.coverCornerRadius, placeholder)
            val notePaint = textPaint(Color.argb(190, 255, 255, 255), 88f, bold = true)
            canvas.drawText("♪", coverRect.centerX() - notePaint.measureText("♪") / 2f, coverRect.centerY() + 30f, notePaint)
        }
        val coverBorder = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2f
            color = Color.argb(70, 255, 255, 255)
        }
        canvas.drawRoundRect(coverRect, metrics.coverCornerRadius, metrics.coverCornerRadius, coverBorder)

        val textLeft = coverRect.right + 40f
        val textWidth = metrics.infoRight - textLeft
        val badgeText = content.roomName
        val badgePaint = textPaint(Color.argb(235, 255, 255, 255), 30f, bold = true)
        val badgeLabel = ellipsize(badgeText, badgePaint, textWidth - 44f)
        val badgeWidth = badgePaint.measureText(badgeLabel) + 44f
        val badgeRect = RectF(textLeft, coverRect.top + 4f, textLeft + badgeWidth, coverRect.top + 60f)
        canvas.drawRoundRect(
            badgeRect,
            badgeRect.height() / 2f,
            badgeRect.height() / 2f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(56, 255, 255, 255) },
        )
        canvas.drawRoundRect(
            badgeRect,
            badgeRect.height() / 2f,
            badgeRect.height() / 2f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = 1.5f
                color = Color.argb(80, 255, 255, 255)
            },
        )
        canvas.drawText(badgeLabel, badgeRect.left + 22f, badgeRect.centerY() + 11f, badgePaint)

        val titlePaint = textPaint(Color.WHITE, 58f, bold = true)
        val titleLines = wrap(content.trackTitle, titlePaint, textWidth, maxLines = 2)
        var textTop = badgeRect.bottom + 62f
        titleLines.forEach { line ->
            canvas.drawText(line, textLeft, textTop, titlePaint)
            textTop += 70f
        }

        val subtitle = shareSubtitleText(content)
        if (subtitle.isNotBlank()) {
            val subtitlePaint = textPaint(Color.argb(226, 255, 255, 255), 34f, bold = false)
            canvas.drawText(ellipsize(subtitle, subtitlePaint, textWidth), textLeft, textTop + 4f, subtitlePaint)
            textTop += 52f
        }

        val metaPaint = textPaint(Color.argb(190, 255, 255, 255), 28f, bold = false)
        val meta = listOf(content.durationText, content.listenerText)
            .filter(String::isNotBlank)
            .joinToString("  ·  ")
        if (meta.isNotBlank()) {
            canvas.drawText(ellipsize(meta, metaPaint, textWidth), textLeft, textTop + 2f, metaPaint)
        }

        val brandPaint = textPaint(Color.argb(150, 255, 255, 255), 26f, bold = false)
        canvas.drawText("Music Together · 一起听歌", metrics.infoLeft, metrics.height - metrics.padding + 6f, brandPaint)
        val linkPaint = textPaint(Color.argb(210, 255, 255, 255), 26f, bold = false)
        canvas.drawText(
            ellipsize(content.link, linkPaint, metrics.infoRight - metrics.infoLeft),
            metrics.infoLeft,
            metrics.height - metrics.padding - 34f,
            linkPaint,
        )
    }

    private fun drawQrCard(canvas: Canvas, metrics: ShareCardMetrics, qr: QrCodeMatrix?) {
        val cardRect = RectF(
            metrics.qrCardRect.left,
            metrics.qrCardRect.top,
            metrics.qrCardRect.right,
            metrics.qrCardRect.bottom,
        )
        canvas.drawRoundRect(
            RectF(cardRect.left, cardRect.top + 16f, cardRect.right, cardRect.bottom + 16f),
            metrics.cornerRadius,
            metrics.cornerRadius,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(90, 0, 0, 0) },
        )
        canvas.drawRoundRect(
            cardRect,
            metrics.cornerRadius,
            metrics.cornerRadius,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = LinearGradient(
                    cardRect.left,
                    cardRect.top,
                    cardRect.right,
                    cardRect.bottom,
                    Color.argb(112, 255, 255, 255),
                    Color.argb(58, 255, 255, 255),
                    Shader.TileMode.CLAMP,
                )
            },
        )
        canvas.drawRoundRect(
            cardRect,
            metrics.cornerRadius,
            metrics.cornerRadius,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = 2f
                color = Color.argb(120, 255, 255, 255)
            },
        )

        val codeRect = RectF(
            metrics.qrCodeRect.left,
            metrics.qrCodeRect.top,
            metrics.qrCodeRect.right,
            metrics.qrCodeRect.bottom,
        )
        canvas.drawRoundRect(
            codeRect,
            24f,
            24f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE },
        )
        if (qr != null) {
            val available = min(codeRect.width(), codeRect.height()) - 32f
            val module = qrModuleSize(qr.size, available)
            val drawSize = module * qr.size
            val startX = codeRect.centerX() - drawSize / 2f
            val startY = codeRect.centerY() - drawSize / 2f
            val modulePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FF14151C") }
            for (y in 0 until qr.size) {
                for (x in 0 until qr.size) {
                    if (!qr.isDark(x, y)) continue
                    canvas.drawRect(
                        startX + x * module,
                        startY + y * module,
                        startX + (x + 1) * module,
                        startY + (y + 1) * module,
                        modulePaint,
                    )
                }
            }
        }
        val hintPaint = textPaint(Color.argb(240, 255, 255, 255), 30f, bold = true)
        val hint = "扫码加入房间"
        canvas.drawText(
            hint,
            cardRect.centerX() - hintPaint.measureText(hint) / 2f,
            cardRect.bottom - 30f,
            hintPaint,
        )
    }

    private fun blurBitmap(source: Bitmap): Bitmap? {
        if (source.width <= 0 || source.height <= 0) return null
        val ratio = source.height.toFloat() / source.width.toFloat()
        val sampleWidth = BLUR_SAMPLE_WIDTH
        val sampleHeight = max(1, (sampleWidth * ratio).toInt())
        var current = runCatching {
            Bitmap.createScaledBitmap(source, sampleWidth, sampleHeight, true)
        }.getOrNull() ?: return null
        repeat(BLUR_PASSES) {
            val next = runCatching {
                Bitmap.createScaledBitmap(current, sampleWidth, sampleHeight, true)
            }.getOrNull()
            if (next != null && next !== current) {
                if (current !== source) current.recycle()
                current = next
            }
        }
        return current
    }

    private fun textPaint(color: Int, size: Float, bold: Boolean): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        typeface = if (bold) {
            Typeface.create("sans-serif-medium", Typeface.BOLD)
        } else {
            Typeface.create("sans-serif", Typeface.NORMAL)
        }
    }

    private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
        if (maxWidth <= 0f || text.isEmpty()) return text
        if (paint.measureText(text) <= maxWidth) return text
        var end = text.length
        while (end > 0) {
            val candidate = text.substring(0, end) + "…"
            if (paint.measureText(candidate) <= maxWidth) return candidate
            end--
        }
        return "…"
    }

    private fun wrap(text: String, paint: Paint, maxWidth: Float, maxLines: Int): List<String> {
        if (text.isEmpty() || maxWidth <= 0f) return listOf(text)
        val lines = mutableListOf<String>()
        var index = 0
        while (index < text.length && lines.size < maxLines) {
            var end = index
            var lastFit = index
            while (end < text.length) {
                end++
                if (paint.measureText(text, index, end) <= maxWidth) lastFit = end else break
            }
            if (lastFit <= index) lastFit = min(text.length, index + 1)
            if (lines.size == maxLines - 1 && lastFit < text.length) {
                lines += ellipsize(text.substring(index), paint, maxWidth)
                index = text.length
            } else {
                lines += text.substring(index, lastFit)
                index = lastFit
            }
        }
        return lines
    }

    private fun darken(color: Int, factor: Float): Int = Color.argb(
        255,
        (Color.red(color) * factor).toInt().coerceIn(0, 255),
        (Color.green(color) * factor).toInt().coerceIn(0, 255),
        (Color.blue(color) * factor).toInt().coerceIn(0, 255),
    )

    private fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
}
