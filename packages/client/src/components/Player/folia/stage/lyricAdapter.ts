import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { useEffect, useMemo, useState } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { buildAMLLLinesFromLrc } from '@/lib/lyricLrc'
import { buildLineRenderHints } from '../lib/renderHints'
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
    // ★ 本项目没有 TTML `<agent>`（AMLL 只给 `isDuet`）。cappella 用 agentId
    //   区分"两个说话人"，因此把 `isDuet` 映射成两值标识，让它的对唱分支
    //   能生效。非对唱曲目两边都是同一个值 → cappella 的 resolver 因
    //   "agent 少于 2 个"返回 null，回落到它自己的左右序列（与上游一致）。
    agentId: line.isDuet ? 'duet' : 'main',
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

  return useMemo(() => attachFoliaInterludes(source.map(toFoliaLine)), [source])
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
      // 不能直接当颜色用，必须包进 rgb()。
      secondaryColor: `rgb(${secondaryRgb})`,
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
