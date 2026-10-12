import { AnimatePresence, useMotionValueEvent } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLineRenderEndTime } from '../../lib/renderHints'
import { shouldPreheatLine, useVisualizerRuntime } from '../../stage/runtime'
import type { FoliaSharedProps } from '../../definition'
import { FoliaShell } from '../../stage/FoliaShell'
import { FoliaSubtitleOverlay } from '../../stage/FoliaSubtitleOverlay'
import { builtinEmoImages } from './emoImages'
import type { PreparedBubbleMetrics } from './cappellaTypes'
import { CAPPELLA_PREHEAT_WINDOW } from './cappellaConstants'
import { getCappellaIntensityConfig } from './cappellaIntensity'
import { buildCappellaMessages } from './cappellaMessages'
import { getVisibleLineIndexAtTime, getVisibleMessages } from './cappellaMessageLayout'
import { getOrBuildBubbleMetrics } from './cappellaBubbleMetrics'
import { CappellaMessageRow } from './CappellaMessageRow'
import { DEFAULT_CAPPELLA_TUNING, type CappellaTuning } from '../../types'

/**
 * Cappella —— 群唱：把歌词演成一场聊天。
 *
 * 移植自 folia-major `src/components/visualizer/cappella/VisualizerCappella.tsx`。
 *
 * 歌词行变成聊天消息：确定性的发送者分配（同一首歌每次一样）、左右气泡、
 * 逐字淡入、时间戳徽标，以及表情回复。间奏行（`......`）会变成一条表情消息。
 *
 * 与上游的差异：
 *   - 外壳换成 `FoliaShell`、字幕层换成 `FoliaSubtitleOverlay`（同其它模式）；
 *   - `t('ui.noTrack')` 直接写中文（本项目无 i18n 运行时）；
 *   - 自定义表情包 / 头像包（上游走 IndexedDB 的 `services/*`）**本轮不接**：
 *     `cappellaCustomEmojiImages` / `cappellaCustomAvatarImages` 保留在契约里，
 *     但舞台始终用内置资源（`builtinEmojiPack` / `builtinAvatarImages`），
 *     因此 `emojiPackSource` / `avatarSource` 的 `'custom'` 分支不会被选中。
 *     要接自定义资源时只需在宿主里传入这两个数组，本组件无需改动。
 *
 * 消息编排、气泡测量、逐字时序逻辑逐字保留。
 */
export function VisualizerCappella(props: FoliaSharedProps) {
  const {
    currentTime,
    currentLineIndex,
    lines,
    theme,
    subtitleTheme,
    showText = true,
    songTitle,
    coverUrl,
    seed,
    lyricsFontScale = 1,
    subtitleFontScale = 1,
    subtitleOverlayOpacity,
    subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
    cappellaTuning = DEFAULT_CAPPELLA_TUNING,
    cappellaCustomEmojiImages = [],
    cappellaCustomAvatarImages = [],
    isPreviewMode = false,
  } = props

  const [viewportSize, setViewportSize] = useState(() =>
    typeof window === 'undefined' ? { width: 1280, height: 900 } : { width: window.innerWidth, height: window.innerHeight },
  )
  const bubbleMetricsCacheRef = useRef(new Map<string, PreparedBubbleMetrics>())
  /**
   * 当前可见的歌词行下标（决定哪些聊天消息在场）。
   *
   * 时间驱动的逐帧更新在下方 `useMotionValueEvent` 里；换歌时的重置用
   * React 官方推荐的"渲染期按 prop 变化调整 state"（见下方说明）。
   */
  const [visibleLineIndex, setVisibleLineIndex] = useState(() => getVisibleLineIndexAtTime(lines, currentTime.get()))
  const titleText = songTitle?.trim() || '暂无曲目'
  const avatarSeed = seed ?? titleText
  const intensityConfig = useMemo(() => getCappellaIntensityConfig(theme.animationIntensity), [theme.animationIntensity])

  const resolvedCappellaTuning = useMemo<CappellaTuning>(
    () => ({
      showEmoMessages: cappellaTuning.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
      emojiPackSource:
        cappellaTuning.emojiPackSource === 'custom' && cappellaCustomEmojiImages.length > 0
          ? 'custom'
          : DEFAULT_CAPPELLA_TUNING.emojiPackSource,
      avatarSource:
        cappellaTuning.avatarSource === 'builtin' ||
        cappellaTuning.avatarSource === 'color' ||
        cappellaTuning.avatarSource === 'cover' ||
        (cappellaTuning.avatarSource === 'custom' && cappellaCustomAvatarImages.length > 0)
          ? cappellaTuning.avatarSource
          : DEFAULT_CAPPELLA_TUNING.avatarSource,
    }),
    [
      cappellaCustomEmojiImages.length,
      cappellaCustomAvatarImages.length,
      cappellaTuning.avatarSource,
      cappellaTuning.emojiPackSource,
      cappellaTuning.showEmoMessages,
    ],
  )

  const activeEmoImages = useMemo(
    () =>
      resolvedCappellaTuning.emojiPackSource === 'custom' && cappellaCustomEmojiImages.length > 0
        ? cappellaCustomEmojiImages
        : builtinEmoImages,
    [cappellaCustomEmojiImages, resolvedCappellaTuning.emojiPackSource],
  )
  const customAvatarImages = useMemo(
    () => (resolvedCappellaTuning.avatarSource === 'custom' ? cappellaCustomAvatarImages : []),
    [cappellaCustomAvatarImages, resolvedCappellaTuning.avatarSource],
  )
  const messages = useMemo(
    () => buildCappellaMessages(lines, titleText, intensityConfig, resolvedCappellaTuning, activeEmoImages, isPreviewMode),
    [activeEmoImages, intensityConfig, isPreviewMode, lines, resolvedCappellaTuning, titleText],
  )

  const baseFontSize = Math.max(15, Math.min(26, 18 * lyricsFontScale))
  const maxPanelWidth = Math.min(Math.max(viewportSize.width - 32, 1), 896)
  const bubbleGroupRatio = viewportSize.width >= 640 ? 0.68 : 0.78
  const maxTextWidth = Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56))

  const visibleMessages = useMemo(
    () =>
      getVisibleMessages(
        messages,
        visibleLineIndex,
        viewportSize.height,
        currentLineIndex,
        currentTime.get(),
        intensityConfig.motion,
        theme,
        baseFontSize,
        maxTextWidth,
      ),
    [
      baseFontSize,
      currentLineIndex,
      currentTime,
      intensityConfig.motion,
      maxTextWidth,
      messages,
      theme,
      viewportSize.height,
      visibleLineIndex,
    ],
  )

  const { activeLine, recentCompletedLine, upcomingLine, nextLines } = useVisualizerRuntime({
    currentTime,
    currentLineIndex,
    lines,
    getLineEndTime: getLineRenderEndTime,
  })

  useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  /**
   * 换歌（`lines` 换了一份）时重置可见行。
   *
   * ★ 上游用 `useEffect` + `setState`，且额外维护一个 `visibleLineIndexRef`
   *   来避免重复 setState。这里改成 React 官方推荐的"渲染期按 prop 变化
   *   调整 state"：只在 `lines` 真的换了一份时调整一次，setState 被条件
   *   包住，不会死循环。
   * ★ 去掉了 `visibleLineIndexRef`：它的唯一作用是"值没变就不 setState"，
   *   而那可以用函数式更新（`prev => prev === next ? prev : next`）表达，
   *   语义相同且少一份需要同步的状态。
   */
  const [prevLines, setPrevLines] = useState(lines)
  if (prevLines !== lines) {
    setPrevLines(lines)
    setVisibleLineIndex(getVisibleLineIndexAtTime(lines, currentTime.get()))
  }

  useMotionValueEvent(currentTime, 'change', (latest: number) => {
    const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, latest)

    // 函数式更新：值没变时返回原引用，React 会跳过重渲染 —— 与上游用 ref
    // 去重的效果一致，但不需要额外维护 ref。
    setVisibleLineIndex((prev) => (prev === nextVisibleLineIndex ? prev : nextVisibleLineIndex))

    if (!upcomingLine || !shouldPreheatLine(upcomingLine, latest, CAPPELLA_PREHEAT_WINDOW)) {
      return
    }

    getOrBuildBubbleMetrics(bubbleMetricsCacheRef.current, {
      line: upcomingLine,
      theme,
      fontSize: baseFontSize * intensityConfig.motion.activeFontMultiplier,
      lineHeightPx: baseFontSize * intensityConfig.motion.activeFontMultiplier * 1.45,
      maxTextWidth,
      paddingX: intensityConfig.motion.activePaddingX,
      paddingY: intensityConfig.motion.activePaddingY,
    })
  })

  return (
    <FoliaShell theme={theme} className="folia-cappella">
      {showText && (
        <div className="relative z-10 flex h-full w-full items-start justify-center overflow-visible px-4 pt-12 pb-36 sm:px-8 sm:pt-16 sm:pb-40 lg:px-14 lg:pt-20">
          <div className="relative flex w-full max-w-4xl flex-col justify-start gap-3 overflow-visible">
            <AnimatePresence initial={false} mode="popLayout">
              {visibleMessages.map((message) => (
                <CappellaMessageRow
                  key={message.id}
                  message={message}
                  currentTime={currentTime}
                  currentLineIndex={currentLineIndex}
                  theme={theme}
                  coverUrl={coverUrl}
                  cappellaTuning={resolvedCappellaTuning}
                  avatarSeed={avatarSeed}
                  baseFontSize={baseFontSize}
                  maxTextWidth={maxTextWidth}
                  metricsCache={bubbleMetricsCacheRef}
                  intensityConfig={intensityConfig}
                  customAvatarImages={customAvatarImages}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Cappella 自己的三个关键帧动画。上游用内联 <style> 注入；这里保留同样
          的做法，因为它们只属于这一个模式，提到 index.css 反而会制造跨文件的
          隐式依赖。 */}
      <style>{`
                @keyframes cappella-char-fade {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes cappella-bubble-glow-pan {
                    from { transform: translateX(0); }
                    to { transform: translateX(-50%); }
                }

                @keyframes cappella-emo-wiggle {
                    0%, 100% { transform: rotate(-1.6deg); }
                    50% { transform: rotate(1.6deg); }
                }
            `}</style>

      <FoliaSubtitleOverlay
        showText={showText}
        activeLine={activeLine}
        recentCompletedLine={recentCompletedLine}
        nextLines={nextLines}
        theme={theme}
        subtitleTheme={subtitleTheme}
        translationFontSize={`${Math.max(14, 16 * lyricsFontScale)}px`}
        upcomingFontSize={`${Math.max(12, 14 * lyricsFontScale)}px`}
        subtitleOverlayOpacity={subtitleOverlayOpacity}
        subtitleOverlayBackground={subtitleOverlayBackground}
        subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
        subtitleFontScale={subtitleFontScale}
        hideTranslationSubtitle={hideTranslationSubtitle}
        showSubtitleTranslation={showSubtitleTranslation}
        subtitleContentMode={subtitleContentMode}
      />
    </FoliaShell>
  )
}
