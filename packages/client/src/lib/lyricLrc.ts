import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'

/**
 * LRC 回退路径的解析与配对。
 *
 * ============================ 为什么提取到这里 ============================
 *
 * 这段逻辑原先**内联在** `components/Player/LyricDisplay.tsx` 里（`parseLRC` /
 * `mergeLyrics` / `toAMLLLines`）。folia 舞台同样需要"没有 TTML 时把
 * `lyric` + `tlyric` 变成 AMLL `LyricLine[]`"这条回退路径。
 *
 * 若在适配层再写一份，两份实现必然漂移（时间配对容差、`endTime` 的兜底
 * 时长、`romanWord` 的取值……）。因此提取成**单一实现**，由
 * `LyricDisplay` 与 `folia/stage/lyricAdapter.ts` 共同消费 —— 行为对两者
 * 天然一致，也少一份要同步维护的代码。
 *
 * 本模块是纯函数，无 React 依赖，可独立测试。
 */

interface LrcLine {
  time: number
  text: string
}

/** 供舞台消费的简化行形状（翻译可选）。 */
export interface MergedLyricLine {
  time: number
  text: string
  translation?: string
}

/**
 * 解析 LRC 文本。
 *
 * 支持 `[mm:ss]`、`[mm:ss.x]`、`[mm:ss.xx]`、`[mm:ss.xxx]` 四种精度。
 */
export function parseLRC(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
  let match

  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
    const time = minutes * 60 + seconds + ms / 1000
    const text = match[4].trim()
    if (text) {
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/**
 * 把原文 LRC 与译文 LRC 配成带翻译的行。
 *
 * 配对规则：先按 0.1s 取整的时间戳精确匹配，未命中则在 ±0.5s 内按 0.1s
 * 步进找最近的一行。歌词源之间常有几十毫秒的时间戳偏差，容差是必要的。
 */
export function mergeLyrics(original: string, translated: string): MergedLyricLine[] {
  const origLines = parseLRC(original)
  if (origLines.length === 0) return []

  const result: MergedLyricLine[] = origLines.map((l) => ({ ...l }))

  if (!translated) return result

  const transLines = parseLRC(translated)
  if (transLines.length === 0) return result

  const transMap = new Map<number, string>()
  for (const tl of transLines) {
    transMap.set(Math.round(tl.time * 10) / 10, tl.text)
  }

  for (const line of result) {
    const key = Math.round(line.time * 10) / 10
    const exact = transMap.get(key)
    if (exact) {
      line.translation = exact
      continue
    }
    for (let offset = 1; offset <= 5; offset++) {
      const near =
        transMap.get(Math.round((line.time + offset * 0.1) * 10) / 10) ??
        transMap.get(Math.round((line.time - offset * 0.1) * 10) / 10)
      if (near) {
        line.translation = near
        break
      }
    }
  }

  return result
}

/**
 * 把 LRC 解析结果转为 AMLL `LyricLine` 格式。
 *
 * 每行只有**一个** word，覆盖整行 —— 这是"没有逐词时间"的可靠信号
 * （消费方可用 `words.length === 1` 判定）。`endTime` 取下一行的开始时间；
 * 最后一行没有下一行，兜底 +5s。
 */
export function toAMLLLines(lines: MergedLyricLine[]): AMLLLyricLine[] {
  return lines.map((line, i, arr) => {
    const startMs = Math.round(line.time * 1000)
    const endMs = Math.round((arr[i + 1]?.time ?? line.time + 5) * 1000)
    return {
      words: [
        {
          word: line.text,
          startTime: startMs,
          endTime: endMs,
          romanWord: '',
          obscene: false,
        },
      ],
      translatedLyric: line.translation ?? '',
      romanLyric: '',
      startTime: startMs,
      endTime: endMs,
      isBG: false,
      isDuet: false,
    }
  })
}

/** LRC 文本 → AMLL 行（原文 + 可选译文）。 */
export function buildAMLLLinesFromLrc(lyric: string, tlyric: string): AMLLLyricLine[] {
  return toAMLLLines(mergeLyrics(lyric, tlyric))
}
