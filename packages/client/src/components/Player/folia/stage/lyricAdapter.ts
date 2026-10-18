import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { useEffect, useMemo, useState } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { buildAMLLLinesFromLrc } from '@/lib/lyricLrc'
import { buildLineRenderHints } from '../upstream/utils/lyrics/renderHints'
import type { Line, Theme, Word } from '../types'
import { attachFoliaInterludes } from './lyricPresentation'

/**
 * 歌词适配层：AMLL `LyricLine[]` → Folia `Line[]`。
 *
 * ============================ 两个真实差异 ============================
 *
 * **① 时间单位。** AMLL 的 `LyricLine` / `LyricWord` 用**毫秒**（上游注释
 * 明确标注），而 folia 的 `Line` / `Word` 用**秒**（同样由上游注释标注）。
 * 换算只在本文件发生，模式内部一律是秒 —— 否则 `wordGlow` 的时长、`tilt`
 * 的脉冲包络、`cappella` 的逐字淡入全部会差 1000 倍。
 *
 * **② 字段名与形状。**
 *
 *   | AMLL                       | Folia                       |
 *   | -------------------------- | --------------------------- |
 *   | `line.words[].word`        | `word.text`                 |
 *   | `line.words[].startTime`ms | `word.startTime` s          |
 *   | `line.translatedLyric`     | `line.translation`          |
 *   | `line.romanLyric`          | `line.romanization`         |
 *   | （无）                     | `line.fullText`（须自行拼） |
 *
 * `fullText` 是 folia 布局的关键输入：`buildPostLyricLayoutUnits` 按它对齐
 * 分段、`tilt` 按它切句、`cappella` 按它算逐字 reveal。上游由解析器烘焙；
 * 这里按 `words[].word` 拼接得到。
 */

/** 毫秒 → 秒。AMLL 的时间是整数毫秒。 */
const toSeconds = (ms: number): number => (Number.isFinite(ms) ? ms / 1000 : 0)

/** 把一行 folia `Line` 折叠成和声叠层的 `LyricBackgroundVocal`（上游 `lineToBackgroundVocal`）。 */
function lineToBackgroundVocal(line: Line): NonNullable<Line['backgroundVocal']> {
  return {
    text: line.fullText,
    startTime: line.startTime,
    endTime: line.endTime,
    words: line.words,
    agentId: line.agentId,
    translation: line.translation,
    romanization: line.romanization,
  }
}

/**
 * 把 AMLL 的一行转成 folia 的 `Line`。
 *
 * 导出供测试直接调用（`__testToFoliaLine`）：时间单位换算（ms → s）差 1000 倍
 * 不会报错但会让全部动画错位，值得单测钉住。生产代码只经 `useFoliaLines`。
 */
export function toFoliaLine(line: AMLLLyricLine, index: number): Line {
  const words: Word[] = (line.words ?? []).map((word) => ({
    text: word.word ?? '',
    startTime: toSeconds(word.startTime),
    endTime: toSeconds(word.endTime),
  }))

  // LRC 回退路径只给一个覆盖整行的 word，此时拼接就是整行文本；
  // TTML 路径的 words 拼接同样等于整行。
  const fullText = words.map((word) => word.text).join('')
  const startTime = toSeconds(line.startTime)
  const endTime = toSeconds(line.endTime)

  return {
    id: `folia-line-${index}`,
    words,
    startTime,
    endTime,
    fullText,
    translation: line.translatedLyric?.trim() || undefined,
    romanization: line.romanLyric?.trim() || undefined,
    // ★ 本项目没有 TTML `<agent>`（AMLL 只给 `isDuet`/`isBG`）。cappella 用
    //   agentId 区分"两个说话人"，因此把 `isDuet` 映射成两值标识；`isBG` 行
    //   映射为 'bg'，供 foldFoliaBackgroundVocals 折叠进主行的和声唱词。
    //   非对唱曲目两边都是同一个值 → cappella 的 resolver 因
    //   "agent 少于 2 个"返回 null，回落到它自己的左右序列（与上游一致）。
    agentId: line.isBG ? 'bg' : line.isDuet ? 'duet' : 'main',
    renderHints: buildLineRenderHints({ startTime, endTime, words }),
  }
}

/**
 * 读取当前曲目的歌词并转成 folia 形状。
 *
 * 数据源与经典播放器**完全同源**（`LyricDisplay.tsx` 的选择逻辑）：
 * `ttmlLines`（TTML / YRC，含逐词时间）优先；缺失时回退到 LRC 路径
 * （`lib/lyricLrc.ts`，与 `LyricDisplay` 共用同一份实现，因此两者的
 * 时间配对与行划分必然一致）。
 *
 * ★ 歌词偏移（`lyricOffsets`）**不在这里应用** —— 它是时间轴偏移，由
 *   `useFoliaClock` 在时钟上减去，与 `LyricDisplay` / `LyricStage` 的
 *   做法一致（那两处也是从 `currentTime` 里减，而不是挪歌词行的时间）。
 */
export function useFoliaLines(): Line[] {
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)

  const source = useMemo(
    () => (ttmlLines && ttmlLines.length > 0 ? ttmlLines : buildAMLLLinesFromLrc(lyric, tlyric)),
    [ttmlLines, lyric, tlyric],
  )

  return useMemo(() => attachFoliaInterludes(foldFoliaBackgroundVocals(source.map(toFoliaLine))), [source])
}

/**
 * 把 AMLL `isBG` 行折叠为紧邻前一个主行的 `backgroundVocal`，供顶部和声叠层
 * （`VisualizerHarmonyOverlay`）消费 —— 上游 TTML 解析器的同语义：每条主行携带
 * 自己的背景唱词，主时间轴不含背景行。
 *
 * ★ 折叠规则：先按 AMLL `optimizeLyricLines` 折叠连续 isBG（只保留每段第一个，
 *   其余降级为普通行），再把幸存的背景行归属**时间上最近的前一个主行**；
 *   找不到主行（曲目以背景行开头）时保留为普通行，不丢内容。行首的
 *   interlude 不参与归属。
 */
export function foldFoliaBackgroundVocals(lines: Line[]): Line[] {
  // 连续 isBG 折叠（AMLL optimizeLyricLines 同语义，mineradio 的
  // foldConsecutiveBackgroundLines 同一规则）。
  const isBackground: boolean[] = []
  let consecutiveBgCount = 0
  for (const line of lines) {
    if (line.agentId === 'bg') {
      consecutiveBgCount += 1
      isBackground.push(consecutiveBgCount <= 1)
    } else {
      consecutiveBgCount = 0
      isBackground.push(false)
    }
  }

  const result: Line[] = []
  let mainIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const isInterlude = line.id?.startsWith('folia-interlude-') ?? false
    if (line.agentId === 'bg') {
      if (!isBackground[index]) {
        result.push(line)
        continue
      }
      if (mainIndex >= 0) {
        const mainLine = result[mainIndex]
        const vocal = lineToBackgroundVocal(line)
        if (!vocal) {
          result.push(line)
          continue
        }
        const vocals = mainLine.backgroundVocals ?? (mainLine.backgroundVocal ? [mainLine.backgroundVocal] : [])
        const next = [...vocals, vocal]
        result[mainIndex] = { ...mainLine, backgroundVocal: next[0], backgroundVocals: next }
      } else {
        result.push(line)
      }
      continue
    }
    result.push(line)
    if (!isInterlude) mainIndex = result.length - 1
  }
  return result
}

/**
 * 当前激活行下标。
 *
 * 与 folia 的 `findLatestActiveLineIndex` 同判据：`startTime <= t <= renderEndTime` 的
 * 最后一行；没有命中时为 -1（模式据此显示"等待音乐"）。
 *
 * ★ 用**二分查找**而不是线性扫描：本函数在每次 store 时间更新时都会被调用，
 *   而长歌词（200+ 行）线性扫描在每帧都是不必要的开销。
 *   `lines` 的 `startTime` 由解析器保证单调递增。
 */
export function findFoliaActiveLineIndex(lines: Line[], timeSeconds: number): number {
  if (lines.length === 0) return -1

  let low = 0
  let high = lines.length - 1
  let candidate = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].startTime <= timeSeconds) {
      candidate = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (candidate < 0) return -1
  // Singing can end before the visual exit does. Prefer the latest eligible line,
  // including an older overlapping line when the newer line has already finished.
  for (let index = candidate; index >= 0; index -= 1) {
    if (timeSeconds <= (lines[index].renderHints?.renderEndTime ?? lines[index].endTime)) return index
  }
  return -1
}

/** 从本项目主题推导 folia 主题。 */
export function useFoliaTheme(): Theme {
  const accent = useCssVarColor('--primary', '#e3b76c')
  const background = useCssVarColor('--background', '#080b12')
  const foreground = useCssVarColor('--foreground', '#f7f1e8')
  const secondaryRgb = useCssVarColor('--theme-secondary-rgb', '116 184 165')

  return useMemo<Theme>(
    () => ({
      name: 'music-together',
      backgroundColor: background,
      primaryColor: foreground,
      accentColor: accent,
      // `--theme-secondary-rgb` 存的是 `R G B` 三元组（见 index.css），
      // 不能直接当颜色用，必须包进 rgb()。逗号分隔 —— folia 的 colorMix
      // 解析器（及上游主题约定）按 rgb(r, g, b) 读；空格分隔会走 fallback
      // 变白色（群唱左侧气泡看不清正是这个）。
      secondaryColor: `rgb(${secondaryRgb.split(/\s+/).join(', ')})`,
      fontStyle: 'sans',
      animationIntensity: 'normal',
    }),
    [accent, background, foreground, secondaryRgb],
  )
}

/**
 * 读一个 CSS 自定义属性的计算值，并跟随主题切换更新。
 *
 * ★ 必须监听：`data-color-preset` 换主题会改这些变量。不监听的话切主题后
 *   舞台配色会停在旧值（经典舞台与 mineradio 读同一批变量，会一起变，
 *   舞台不跟着变就明显不一致）。
 * ★ 只在挂载与主题属性变化时读，不做每帧轮询。
 */
function useCssVarColor(name: string, fallback: string): string {
  const [resolved, setResolved] = useState(fallback)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return

    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      if (name === '--theme-secondary-rgb' || !raw) {
        setResolved(raw || fallback)
        return
      }
      // Upstream shaders accept rgb/hex; convert the host's oklch tokens once per theme change.
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        setResolved(raw)
        return
      }
      context.fillStyle = raw
      context.fillRect(0, 0, 1, 1)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      setResolved(`rgb(${r}, ${g}, ${b})`)
    }
    read()

    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-preset', 'class'] })
    return () => observer.disconnect()
  }, [name, fallback])

  return resolved
}
