import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { buildPostLyricLayoutUnits, buildDisplayWordsFromLayoutUnits } from '../../lib/cjkSemanticLayout'
import { getLineRenderEndTime } from '../../lib/renderHints'
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../lib/fontStacks'
import { useVisualizerRuntime } from '../../stage/runtime'
import type { FoliaSharedProps } from '../../definition'
import { FoliaShell } from '../../stage/FoliaShell'
import { FoliaSubtitleOverlay } from '../../stage/FoliaSubtitleOverlay'
import { resolveSubtitleFontSizes } from '../../stage/subtitleFontSizes'
import { resolveWordColor } from '../../stage/wordColoring'
import { GlowWord } from '../../stage/GlowWord'
import { getGlowWordLineContainerMotion, resolveGlowWordRenderProfile } from '../../stage/glowWordTiming'
import { buildGlowWordLayoutVariants, glowWordBodyVariants } from '../../stage/glowWordVariants'
import { DEFAULT_CLASSIC_TUNING, type ClassicTuning } from '../../types'

/**
 * Luminous（上游 mode id 为 `classic`）—— 逐词辉光歌词。
 *
 * 移植自 folia-major `src/components/visualizer/classic/Visualizer.tsx`。
 * 这是整个目录里最直接的歌词管线，也是其它模式借用时序思路的基线：
 *
 *   ① 问 runtime 当前是哪一行；
 *   ② 读该行的 `renderHints`；
 *   ③ 给每个词生成一份确定性的松散布局，让每个词各自动画、不依赖父级重渲染。
 *
 * 一个词有三种状态：`waiting`（未到，保持轻量的入场前姿态）、
 * `active`（正在唱，驱动辉光/主体/涟漪）、`passed`（已唱过，留一点余晖与漂移）。
 *
 * 与上游的差异（仅三处，均为环境适配）：
 *   - 外壳换成 `FoliaShell`（上游 shell 牵入背景层与 mod 系统）；
 *   - 字幕层换成 `FoliaSubtitleOverlay`（上游那层依赖播放页底栏布局 store）；
 *   - `t('ui.waitingForMusic')` 直接写中文（本项目无 i18n 运行时）。
 * 布局、时序、着色与变体逻辑逐字保留。
 */

interface WordLayoutConfig {
  id: string
  x: number
  y: number
  rotate: number
  scale: number
  marginRight: string
  alignSelf: string
  passedRotate: number
}

interface LineLayoutConfig {
  justifyContent: string
  alignItems: string
  perspective: number
}

const clampClassicBreathingFloatMultiplier = (value: number) => Math.min(2, Math.max(0, value))
const clampClassicWordSpacing = (value: number) => Math.min(2, Math.max(0, value))

const resolveClassicTuning = (tuning?: ClassicTuning): ClassicTuning => ({
  enableWordRotation: tuning?.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
  breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
    tuning?.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
  ),
  useLegacyLayout: tuning?.useLegacyLayout ?? DEFAULT_CLASSIC_TUNING.useLegacyLayout,
  wordSpacing: clampClassicWordSpacing(tuning?.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7),
})

let classicMeasureCanvas: HTMLCanvasElement | null = null

/** 用 2D canvas 量一个词在给定字体下的宽度。 */
const measureWordWidth = (text: string, pxSize: number, fontStack: string, fontWeight: number): number => {
  if (typeof document === 'undefined') {
    return text.length * pxSize * 0.65
  }
  if (!classicMeasureCanvas) {
    classicMeasureCanvas = document.createElement('canvas')
  }
  const context = classicMeasureCanvas.getContext('2d')
  if (!context) {
    return text.length * pxSize * 0.65
  }
  context.font = `${fontWeight} ${pxSize}px ${fontStack}`
  return context.measureText(text).width
}

export function VisualizerLuminous(props: FoliaSharedProps) {
  const {
    currentTime,
    currentLineIndex,
    lines,
    theme,
    subtitleTheme,
    showText = true,
    showWaitingPlaceholder = true,
    lyricsFontScale = 1,
    subtitleFontScale = 1,
    subtitleOverlayOpacity,
    subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
    classicTuning,
  } = props

  const resolvedClassicTuning = useMemo(() => resolveClassicTuning(classicTuning), [classicTuning])
  const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
    currentTime,
    currentLineIndex,
    lines,
    getLineEndTime: getLineRenderEndTime,
  })
  const activeLineRenderProfile = activeLine ? resolveGlowWordRenderProfile(activeLine) : null
  const activeWordRenderProfile = activeLineRenderProfile ?? (activeLine ? resolveGlowWordRenderProfile(activeLine) : null)
  const activeLineContainerMotion = getGlowWordLineContainerMotion(activeLineRenderProfile)

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1200 : window.innerWidth,
  )

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const displayWords = useMemo(() => {
    if (!activeLine) return []
    if (resolvedClassicTuning.useLegacyLayout) {
      return activeLine.words
    }
    const layoutUnits = buildPostLyricLayoutUnits(activeLine, { semantic: true, sticky: true })
    return buildDisplayWordsFromLayoutUnits(layoutUnits)
  }, [activeLine, resolvedClassicTuning.useLegacyLayout])

  const mainFontSize = `clamp(${(2.25 * lyricsFontScale).toFixed(3)}rem, ${(6 * lyricsFontScale).toFixed(3)}vw, ${(4.5 * lyricsFontScale).toFixed(3)}rem)`
  const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`
  const { translationFontSize, upcomingFontSize } = resolveSubtitleFontSizes(lyricsFontScale)

  // 为当前行生成一份稳定的随机布局。用行的 startTime 当种子，
  // 同一句歌词不会在每次重渲染时重新洗牌。
  const { wordConfigs, lineConfig } = useMemo(() => {
    if (!activeLine) {
      return {
        wordConfigs: [] as WordLayoutConfig[],
        lineConfig: { justifyContent: 'justify-center', alignItems: 'center', perspective: 1000 } as LineLayoutConfig,
      }
    }

    const seed = activeLine.startTime
    const intensity = theme.animationIntensity

    // intensity 主要控制随机散布能有多野。
    const isChaotic = intensity === 'chaotic'
    const isCalm = intensity === 'calm'

    // 容器布局决定整行在视觉场里的落位，之后词级偏移再叠加。
    const justifyOptions = isCalm
      ? ['justify-center']
      : ['justify-start', 'justify-center', 'justify-end', 'justify-around', 'justify-between']
    const alignOptions = isCalm ? ['items-center'] : ['items-start', 'items-center', 'items-end']

    const isInterlude = activeLine.fullText === '......'

    const lineConfig: LineLayoutConfig = {
      justifyContent: isInterlude ? 'justify-center' : justifyOptions[Math.floor(seed % justifyOptions.length)],
      alignItems: alignOptions[Math.floor((seed * 2) % alignOptions.length)],
      perspective: isChaotic ? 500 + (seed % 500) : 1000,
    }

    // 词布局对给定行保持确定性：时间只改变动画状态，不改变基础几何。
    const fontStack = resolveThemeFontStack(theme)
    const fontWeight = resolveThemeFontWeight(theme, 700)
    const getPixelFontSize = (fontScale: number, width: number): number => {
      const rem = 16
      const minPx = 2.25 * fontScale * rem
      const valPx = (6 * fontScale * width) / 100
      const maxPx = 4.5 * fontScale * rem
      return Math.max(minPx, Math.min(valPx, maxPx))
    }
    const pxFontSize = getPixelFontSize(lyricsFontScale, viewportWidth)
    const wordWidths = displayWords.map((w) => measureWordWidth(w.text, pxFontSize, fontStack, fontWeight))

    const baseSpread = isChaotic ? 60 : isCalm ? 0 : 20
    const baseRotate = isChaotic ? 30 : isCalm ? 0 : 5

    const wordConfigs: WordLayoutConfig[] = displayWords.map((w, i) => {
      const wordSeed = seed + i

      // 极小的确定性 RNG，让每个词拿到可复现的偏移。
      const random = (offset: number) => {
        const x = Math.sin(wordSeed + offset) * 10000
        return x - Math.floor(x)
      }

      if (isInterlude) {
        return {
          id: `${w.text}-${i}-${seed}`,
          x: 0,
          y: (random(2) - 0.5) * 15,
          rotate: 0,
          scale: 1.5,
          marginRight: '3rem',
          alignSelf: 'center',
          passedRotate: 0,
        }
      }

      const wordConfigScale = isChaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2
      const xVal = (random(1) - 0.5) * baseSpread * 2
      const yVal = (random(2) - 0.5) * baseSpread * 2

      let marginRight = isChaotic ? `${random(5) * 1.5}rem` : '0.8rem'

      if (!resolvedClassicTuning.useLegacyLayout) {
        // 精确算出右边距，避免缩放与位移过程中视觉重叠。
        const w_i = wordWidths[i] ?? 0
        const s_i = wordConfigScale * 1.4

        let w_next = 0
        let s_next = 1.0
        let x_next = 0

        if (i + 1 < displayWords.length) {
          const nextSeed = seed + (i + 1)
          const nextRandom = (offset: number) => {
            const x = Math.sin(nextSeed + offset) * 10000
            return x - Math.floor(x)
          }
          const nextConfigScale = isChaotic ? 0.8 + nextRandom(4) * 0.6 : 1.1 + nextRandom(4) * 0.2
          s_next = nextConfigScale * 1.4
          x_next = (nextRandom(1) - 0.5) * baseSpread * 2
          w_next = wordWidths[i + 1] ?? 0
        }

        const spacingMultiplier = resolvedClassicTuning.wordSpacing ?? 0.7
        const gap = 0.05 * pxFontSize
        const halfOverflow_i = (w_i * (s_i - 1)) / 2
        const halfOverflow_next = (w_next * (s_next - 1)) / 2
        const xOffsetDiff = xVal - x_next

        const calculatedMargin = (halfOverflow_i + halfOverflow_next + xOffsetDiff + gap) * spacingMultiplier
        const minMargin = (isChaotic ? 0.08 * pxFontSize : 0.12 * pxFontSize) * spacingMultiplier
        const finalMargin = Math.max(minMargin, calculatedMargin)
        marginRight = `${finalMargin.toFixed(1)}px`
      }

      return {
        id: `${w.text}-${i}-${seed}`,
        x: xVal,
        y: yVal,
        rotate: resolvedClassicTuning.enableWordRotation ? (random(3) - 0.5) * baseRotate * 2 : 0,
        scale: wordConfigScale,
        marginRight,
        alignSelf: isChaotic && random(6) > 0.7 ? (random(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
        passedRotate: resolvedClassicTuning.enableWordRotation ? (random(8) - 0.5) * 45 : 0,
      }
    })

    return { wordConfigs, lineConfig }
  }, [
    activeLine,
    displayWords,
    resolvedClassicTuning.enableWordRotation,
    resolvedClassicTuning.useLegacyLayout,
    resolvedClassicTuning.wordSpacing,
    theme,
    lyricsFontScale,
    viewportWidth,
  ])

  const layoutVariants = buildGlowWordLayoutVariants(theme.animationIntensity, resolvedClassicTuning.enableWordRotation)
  const bodyVariants = glowWordBodyVariants

  const lyricContainerFloat = useMemo(() => {
    const multiplier = resolvedClassicTuning.breathingFloatMultiplier
    if (multiplier <= 0) {
      return null
    }

    // 整行轻微的呼吸感，让两次词事件之间画面不会完全静止。
    const configByIntensity = {
      calm: { distance: 10, duration: 8.5 },
      normal: { distance: 14, duration: 7 },
      chaotic: { distance: 18, duration: 5.8 },
    } as const

    const { distance, duration } = configByIntensity[theme.animationIntensity]
    const scaledDistance = distance * multiplier

    return {
      animate: {
        y: [0, -scaledDistance, 0, scaledDistance * 0.45, 0],
        scale: [1, 1 + 0.01 * multiplier, 1, 1 - 0.005 * multiplier, 1],
      },
      transition: {
        duration,
        repeat: Infinity,
        ease: 'easeInOut' as const,
      },
    }
  }, [resolvedClassicTuning.breathingFloatMultiplier, theme.animationIntensity])

  return (
    <FoliaShell theme={theme} className="folia-luminous">
      <motion.div
        className="pointer-events-none relative z-10 flex h-[70vh] w-full items-center justify-center p-8 will-change-transform"
        animate={lyricContainerFloat?.animate}
        transition={lyricContainerFloat?.transition}
      >
        <AnimatePresence mode="popLayout">
          {showText && activeLine && (
            <motion.div
              key={activeLine.startTime}
              initial={activeLineContainerMotion.initial}
              animate={activeLineContainerMotion.animate}
              exit={activeLineContainerMotion.exit}
              className={`flex w-full max-w-6xl flex-wrap content-center ${lineConfig.justifyContent} ${lineConfig.alignItems}`}
              style={{ perspective: `${lineConfig.perspective}px`, minHeight: '300px' }}
            >
              {displayWords.map((word, idx) => {
                const config = wordConfigs[idx] || {
                  id: `fallback-${idx}`,
                  x: 0,
                  y: 0,
                  rotate: 0,
                  scale: 1,
                  marginRight: '0.5rem',
                  alignSelf: 'auto',
                  passedRotate: 0,
                }

                const activeColor = resolveWordColor(word.text, theme.wordColors, theme.accentColor)

                return (
                  <GlowWord
                    key={`${word.text}-${idx}-${activeLine.startTime}`}
                    word={word}
                    config={config}
                    currentTime={currentTime}
                    theme={theme}
                    layoutVariants={layoutVariants}
                    bodyVariants={bodyVariants}
                    baseColor={theme.primaryColor}
                    activeColor={activeColor}
                    renderProfile={activeWordRenderProfile!}
                    isChorus={activeLine.isChorus}
                    fontSize={mainFontSize}
                    layoutStyle={{ marginRight: config.marginRight, alignSelf: config.alignSelf }}
                  />
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
