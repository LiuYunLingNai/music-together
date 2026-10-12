import { AnimatePresence, motion } from 'motion/react'
import type { Line, SubtitleContentMode, Theme } from '../types'
import { resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../lib/fontStacks'
import { resolveLyricSubtitleTracks, resolveSubtitleContentMode, type SubtitleTrack } from '../lib/alternateText'
import {
  SECONDARY_TRACK_FONT_WEIGHT_FALLBACK,
  SECONDARY_TRACK_GAP_EM,
  SECONDARY_TRACK_OPACITY,
  SECONDARY_TRACK_SIZE_FACTOR,
} from '../lib/subtitleTrackStyle'
import { colorWithAlpha } from '../lib/colorMix'

/**
 * 共享底部字幕层。
 *
 * 移植自 folia-major 的 `VisualizerSubtitleOverlay.tsx`，但**去掉了一处应用耦合**：
 * 上游用 `usePlayerSubtitleBottomPx(isPlayerChromeHidden)` 从播放器底栏布局
 * store / MotionValue 里取字幕基线，那个 hook 会牵入 `stores/motionSignals`、
 * `stores/usePlayerChromeSettingsStore` 与 `floating-player/PlayerBottomBarLayoutContext`
 * —— 全是上游 Electron 播放页的布局体系，本项目没有对应物。
 *
 * 这里使用舞台注入的 `--folia-subtitle-bottom`，跟随控制栏离底距离与
 * 响应式高度；缺失时回退到 6.5rem。字幕内容与行选择逻辑沿用上游。
 */

/**
 * 纯占位符行（"//"、"●●●"、破折号、器乐段落的散落斜杠）在歌词数据里是
 * 时间占位，不是显示文本：只有含至少一个字母或数字的字符串才会被显示
 * （任意文字系统 —— CJK 算 `\p{L}`）。译词与下一句预览都套这一条，
 * 因此任何占位符都不会漏进字幕层。
 */
const hasReadableText = (text?: string | null): boolean => !!text && /[\p{L}\p{N}]/u.test(text)

/**
 * 下一句预览的 class。
 *
 * ★ 不导出：本文件被 `react-refresh/only-export-components` 约束 —— 同时导出
 *   组件与非组件会让 HMR 无法判断该模块能否热替换，从而退化成整页刷新。
 *   这个 helper 只有本文件用，不需要导出。
 */
const getUpcomingLyricsClassName = (blur = true): string =>
  `truncate max-w-2xl mx-auto transition-all duration-500${blur ? ' blur-[1px]' : ''}`

interface FoliaSubtitleOverlayProps {
  isPlayerChromeHidden?: boolean
  showText: boolean
  activeLine: Line | null
  recentCompletedLine: Line | null
  nextLines: Line[]
  theme: Theme
  subtitleTheme?: Theme
  translationFontSize: string
  upcomingFontSize: string
  subtitleFontScale?: number
  opacity?: number
  subtitleOverlayOpacity?: number
  subtitleOverlayBackground?: boolean
  subtitleUpcomingLyricsBlur?: boolean
  hideTranslationSubtitle?: boolean
  showSubtitleTranslation?: boolean
  subtitleContentMode?: SubtitleContentMode
}

/**
 * 选出要显示的行：active / recentCompletedLine 里第一个有任何可读行的那个。
 * `'both'` 先音译后译词，缺哪个跳哪个（不留空占位行）。
 *
 * ★ 不导出：见 `getUpcomingLyricsClassName` 的说明（react-refresh 要求
 *   组件文件只导出组件）。需要单测这个纯函数时，把它提到
 *   `lib/subtitleOverlayContent.ts` 更合适；当前没有独立消费者。
 */
const resolveFoliaSubtitleOverlayContent = ({
  showText,
  activeLine,
  recentCompletedLine,
  nextLines,
  hideTranslationSubtitle = false,
  showSubtitleTranslation = true,
  subtitleContentMode,
}: Pick<
  FoliaSubtitleOverlayProps,
  | 'showText'
  | 'activeLine'
  | 'recentCompletedLine'
  | 'nextLines'
  | 'hideTranslationSubtitle'
  | 'showSubtitleTranslation'
  | 'subtitleContentMode'
>) => {
  if (!showText || hideTranslationSubtitle) {
    return {
      shouldRenderOverlay: false,
      subtitleText: null as string | null,
      subtitleTracks: [] as SubtitleTrack[],
      upcomingLines: [] as Line[],
    }
  }

  const resolvedMode = resolveSubtitleContentMode(subtitleContentMode, showSubtitleTranslation)
  const subtitleTracks =
    [activeLine, recentCompletedLine]
      .map((line) => resolveLyricSubtitleTracks(line, resolvedMode, hasReadableText))
      .find((tracks) => tracks.length > 0) ?? []
  const subtitleText = subtitleTracks.length > 0 ? subtitleTracks.map((track) => track.text).join(' / ') : null
  const previewLines = nextLines.filter((line) => hasReadableText(line.fullText))

  return {
    shouldRenderOverlay: true,
    subtitleText,
    subtitleTracks,
    upcomingLines: subtitleText ? [] : activeLine ? previewLines : [],
  }
}

export function FoliaSubtitleOverlay({
  showText,
  activeLine,
  recentCompletedLine,
  nextLines,
  theme,
  subtitleTheme,
  translationFontSize,
  upcomingFontSize,
  subtitleFontScale = 1,
  opacity = 0.6,
  subtitleOverlayOpacity,
  subtitleOverlayBackground = true,
  subtitleUpcomingLyricsBlur = true,
  hideTranslationSubtitle = false,
  showSubtitleTranslation = true,
  subtitleContentMode,
}: FoliaSubtitleOverlayProps) {
  const { shouldRenderOverlay, subtitleText, subtitleTracks, upcomingLines } = resolveFoliaSubtitleOverlayContent({
    showText,
    activeLine,
    recentCompletedLine,
    nextLines,
    hideTranslationSubtitle,
    showSubtitleTranslation,
    subtitleContentMode,
  })
  const resolvedOpacity = subtitleOverlayOpacity ?? opacity
  const scaleFontSize = (fontSize: string, factor = 1) =>
    fontSize.replace(
      /(-?\d*\.?\d+)(rem|vw|px)/g,
      (_match, value, unit) => `${(Number(value) * subtitleFontScale * factor).toFixed(3)}${unit}`,
    )
  const contentClassName = subtitleOverlayBackground ? 'relative isolate inline-block px-1.5 py-0.5' : 'inline-block'
  // iOS Safari 会在附近的 WebKit mask 重新合成时丢掉带 filter 的负层。
  const subtitleGlowStyle = subtitleOverlayBackground
    ? {
        background: `radial-gradient(ellipse 115% 130% at center, ${colorWithAlpha(theme.backgroundColor, 0.96)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.78)} 62%, transparent 100%)`,
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden' as const,
      }
    : undefined
  const textShadow = `0 1px 2px ${colorWithAlpha(theme.backgroundColor, 0.24)}`

  return (
    <AnimatePresence>
      {shouldRenderOverlay && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: resolvedOpacity, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{
            opacity: { duration: 0.24, ease: 'easeOut' },
            y: { duration: 0.24, ease: 'easeOut' },
          }}
          // 由宿主注入安全距离，避免调高播放栏后遮挡字幕。
          // 不要改回 transform：这一层下面压着 blur 辉光，多一个合成层就会变色。
          style={{ bottom: 'var(--folia-subtitle-bottom, 6.5rem)' }}
          className="pointer-events-none absolute right-0 left-0 z-20 space-y-2 px-4 text-center"
        >
          {subtitleText ? (
            <div className={contentClassName}>
              {subtitleOverlayBackground && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-10 -inset-y-6 z-0 blur-2xl"
                  style={subtitleGlowStyle}
                />
              )}
              <motion.div
                key={`trans-${activeLine?.startTime || recentCompletedLine?.startTime}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="relative z-10 mx-auto max-w-4xl"
              >
                {subtitleTracks.map((track, index) => {
                  // 单独一行保持完整的单字幕外观；只有堆叠的第二行才降一档。
                  const isSecondaryRow = index > 0
                  return (
                    <div
                      key={track.role}
                      data-subtitle-track={track.role}
                      style={{
                        color: theme.secondaryColor,
                        fontSize: scaleFontSize(translationFontSize, isSecondaryRow ? SECONDARY_TRACK_SIZE_FACTOR : 1),
                        fontFamily: resolveThemeTranslationFontStack(subtitleTheme ?? theme),
                        fontWeight: resolveThemeFontWeight(
                          subtitleTheme ?? theme,
                          isSecondaryRow ? SECONDARY_TRACK_FONT_WEIGHT_FALLBACK : 500,
                        ),
                        opacity: isSecondaryRow ? SECONDARY_TRACK_OPACITY : undefined,
                        marginTop: isSecondaryRow ? `${SECONDARY_TRACK_GAP_EM}em` : undefined,
                        textShadow,
                      }}
                    >
                      {track.text}
                    </div>
                  )
                })}
              </motion.div>
            </div>
          ) : activeLine && upcomingLines.length > 0 ? (
            <div className={`${contentClassName} space-y-2`}>
              {subtitleOverlayBackground && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-10 -inset-y-6 z-0 blur-2xl"
                  style={subtitleGlowStyle}
                />
              )}
              <div className="relative z-10 space-y-2">
                {upcomingLines.map((line, index) => (
                  <p
                    key={index}
                    className={getUpcomingLyricsClassName(subtitleUpcomingLyricsBlur)}
                    style={{
                      color: theme.secondaryColor,
                      fontSize: scaleFontSize(upcomingFontSize),
                      fontWeight: resolveThemeFontWeight(subtitleTheme ?? theme, 400),
                      textShadow,
                    }}
                  >
                    {line.fullText}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
