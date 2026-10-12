import { AnimatePresence, motion, useMotionValueEvent } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLineRenderEndTime } from '../../lib/renderHints'
import { shouldPreheatLine, useVisualizerRuntime } from '../../stage/runtime'
import type { FoliaSharedProps } from '../../definition'
import { FoliaShell } from '../../stage/FoliaShell'
import { FoliaSubtitleOverlay } from '../../stage/FoliaSubtitleOverlay'
import { buildGlowWordLayoutVariants, glowWordBodyVariants } from '../../stage/glowWordVariants'
import { getGlowWordLineContainerMotion, resolveGlowWordRenderProfile } from '../../stage/glowWordTiming'
import {
  EMPTY_PARTITA_LAYOUT,
  PARTITA_PREHEAT_WINDOW,
  type PartitaSequentialLayout,
  getOrBuildPartitaLayout,
  resolvePartitaTuning,
} from './partitaLayout'
import { PartitaChunk } from './PartitaChunk'
import { DEFAULT_PARTITA_TUNING, type Line } from '../../types'

/**
 * Partita —— 云阶：分栏/分块的逐词歌词。
 *
 * 移植自 folia-major `src/components/visualizer/partita/VisualizerPartita.tsx`。
 *
 * 与 Luminous 同样是词驱动，但多了一步：**先**把整行拆成 chunk、摆进若干列，
 * **再**让词在那个结构里动。流程是：问 runtime 当前行 → 预热下一行 →
 * 把当前行切块 → 摆进列 → 词在结构内动画。关键是词在动的时候布局要感觉稳定。
 *
 * 词的三态与 Luminous 同构：`waiting` 已有布局但保持未入场的轻量姿态；
 * `active` 才发生错峰、高亮与整行能量；`passed` 回落到柔和的离场态，
 * chunk 保留一点结构作为余像。
 *
 * 与上游的差异同 Luminous（外壳、字幕层、等待文案），
 * 布局与时序逻辑逐字保留。
 */
export function VisualizerPartita(props: FoliaSharedProps) {
  const {
    currentTime,
    currentLineIndex,
    lines,
    theme,
    subtitleTheme,
    showText = true,
    showWaitingPlaceholder = true,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    lyricsFontScale = 1,
    subtitleFontScale = 1,
    subtitleOverlayOpacity,
    subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
  } = props

  const [windowHeight, setWindowHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const resolvedPartitaTuning = useMemo(() => resolvePartitaTuning(partitaTuning), [partitaTuning])
  /**
   * 布局缓存。
   *
   * ★ 上游用 `useRef(new Map())` 并在 `useMemo` 里读 `.current` —— 那是
   *   **渲染期读 ref**，React Compiler 会拒绝（`react-hooks/refs`），而且在
   *   并发渲染下被丢弃的那次渲染仍会写入缓存。
   *   改用 `useState` 的惰性初始化：这个 Map 的**身份**跨渲染恒定（React
   *   保证 state 值稳定），但它是普通值而非 ref，因此渲染期读它是合法的。
   *   缓存本身就是"渲染期可读写"的东西，这正是它需要的语义。
   */
  const [layoutCache] = useState(() => new Map<string, PartitaSequentialLayout>())

  useEffect(() => {
    // ★ 不在 effect 里先 setWindowHeight(window.innerHeight) 同步一次：
    //   初值已由 useState 的惰性初始化读过（`typeof window === 'undefined'`
    //   时回退 800，供测试/SSR 用），因此这里的首帧同步是多余的 ——
    //   而"在 effect 里同步 setState"会造成一次级联渲染
    //   （react-hooks/set-state-in-effect）。只保留 resize 订阅。
    const handleResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { activeLine, upcomingLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
    currentTime,
    currentLineIndex,
    lines,
    getLineEndTime: getLineRenderEndTime,
  })
  const activeLineRenderProfile = activeLine ? resolveGlowWordRenderProfile(activeLine) : null
  const activeLineContainerMotion = getGlowWordLineContainerMotion(activeLineRenderProfile)

  const sequentialLayout = useMemo(() => {
    if (!activeLine) {
      return EMPTY_PARTITA_LAYOUT
    }

    return getOrBuildPartitaLayout(layoutCache, activeLine, theme, windowHeight, resolvedPartitaTuning)
  }, [activeLine, theme, windowHeight, resolvedPartitaTuning, layoutCache])

  const nextLineRef = useRef<Line | null>(upcomingLine)
  useEffect(() => {
    nextLineRef.current = upcomingLine
  }, [upcomingLine])

  useMotionValueEvent(currentTime, 'change', (latest: number) => {
    const nextLine = nextLineRef.current
    if (!nextLine) {
      return
    }

    if (!shouldPreheatLine(nextLine, latest, PARTITA_PREHEAT_WINDOW)) {
      return
    }

    getOrBuildPartitaLayout(layoutCache, nextLine, theme, windowHeight, resolvedPartitaTuning)
  })

  const densityScale = sequentialLayout.totalGraphemes > 40 ? 0.8 : 1
  const mainFontSize = `clamp(${(2.5 * densityScale * lyricsFontScale).toFixed(3)}rem, ${(5.5 * densityScale * lyricsFontScale).toFixed(3)}vw, ${(4.5 * densityScale * lyricsFontScale).toFixed(3)}rem)`
  const emptyFontSize = `clamp(${(1.2 * lyricsFontScale).toFixed(3)}rem, ${(2.8 * lyricsFontScale).toFixed(3)}vw, ${(1.9 * lyricsFontScale).toFixed(3)}rem)`
  const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`
  const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.8 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`

  const layoutVariants = buildGlowWordLayoutVariants(theme.animationIntensity)
  const bodyVariants = glowWordBodyVariants

  const lyricContainerFloat = useMemo(() => {
    const configByIntensity = {
      calm: { distance: 10, duration: 8.5 },
      normal: { distance: 14, duration: 7 },
      chaotic: { distance: 18, duration: 5.8 },
    } as const

    const { distance, duration } = configByIntensity[theme.animationIntensity]

    return {
      animate: {
        y: [0, -distance, 0, distance * 0.45, 0],
        scale: [1, 1.01, 1, 0.995, 1],
      },
      transition: {
        duration,
        repeat: Infinity,
        ease: 'easeInOut' as const,
      },
    }
  }, [theme.animationIntensity])

  return (
    <FoliaShell theme={theme} className="folia-partita">
      <motion.div
        className="pointer-events-none relative z-10 flex h-[70vh] w-full items-center justify-center p-8 will-change-transform"
        animate={lyricContainerFloat.animate}
        transition={lyricContainerFloat.transition}
      >
        <AnimatePresence mode="popLayout">
          {showText && activeLine && activeLineRenderProfile && (
            <motion.div
              key={activeLine.startTime}
              initial={activeLineContainerMotion.initial}
              animate={activeLineContainerMotion.animate}
              exit={activeLineContainerMotion.exit}
              className="flex w-full max-w-5xl flex-row-reverse items-stretch justify-center"
              style={{
                perspective: `${sequentialLayout.lineConfig.perspective}px`,
                gap: sequentialLayout.lineConfig.columnGap,
                minHeight: '320px',
              }}
            >
              {sequentialLayout.columns.map((column) => {
                return (
                  <div
                    key={column.id}
                    className="relative flex min-h-[24rem] min-w-[3.8rem] items-center justify-center px-3"
                  >
                    <div className="relative z-10 flex flex-col items-center justify-start">
                      {column.words.map(({ chunkWords, displayWords, config, rowIndex }) => (
                        <PartitaChunk
                          key={`${config.id}`}
                          chunkWords={chunkWords}
                          displayWords={displayWords}
                          config={config}
                          guideIndex={rowIndex}
                          currentTime={currentTime}
                          theme={theme}
                          layoutVariants={layoutVariants}
                          bodyVariants={bodyVariants}
                          baseColor={theme.primaryColor}
                          renderProfile={activeLineRenderProfile}
                          isChorus={activeLine.isChorus}
                          showGuideLines={resolvedPartitaTuning.showGuideLines}
                          fontSize={mainFontSize}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </motion.div>
          )}

          {showText && showWaitingPlaceholder && !activeLine && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute text-2xl opacity-50"
              style={{
                color: theme.secondaryColor,
                fontSize: emptyFontSize,
              }}
            >
              等待音乐
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <FoliaSubtitleOverlay
        showText={showText}
        activeLine={activeLine}
        recentCompletedLine={recentCompletedLine}
        nextLines={nextLines}
        theme={theme}
        subtitleTheme={subtitleTheme}
        translationFontSize={translationFontSize}
        upcomingFontSize={upcomingFontSize}
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
