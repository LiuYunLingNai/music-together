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
  isBG: boolean
}

/** 供舞台消费的简化行形状（翻译可选）。 */
export interface MergedLyricLine {
  time: number
  text: string
  translation?: string
  isBG: boolean
}

/** 行首时间戳（可连续多个）与其后的正文。 */
const LEADING_TIMESTAMPS = /^(?:\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\])+/
const SINGLE_TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
/** 整行被一对括号包住 = 背景人声（上游 `parseLrc` 的 `bgRegex` 同语义）。 */
const BACKGROUND_LINE = /^[(（](.+)[)）]$/

/**
 * 解析 LRC 文本。
 *
 * 支持 `[mm:ss]`、`[mm:ss.x]`、`[mm:ss.xx]`、`[mm:ss.xxx]` 四种精度
 * （小数分隔符 `.` 与 `:` 都接受，后者是部分平台导出的写法）。
 *
 * ★ 一行可带**多个**时间戳：`[00:12.00][01:30.00]副歌` 表示同一句歌词在
 *   两个时刻各唱一遍。只取第一个会同时造成三处错误 —— 后一个时刻没有行
 *   （上一行被拉长，画面停住）、时间戳留在正文里被显示出来、并且混进
 *   `normalizeLyricText` 的字符数污染打分。因此这里按时间戳逐个展开。
 *
 * ★ 整行被括号包住 `（和声）` 是背景人声：上游 `parseLrc` / `parseYrc` 都这么
 *   判定，且会把括号剥掉再显示。不剥的话括号会留在画面上，并且这行会被当成
 *   普通主行 —— 与 TTML 路径的处置不一致。
 */
export function parseLRC(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []

  for (const rawLine of lrc.split(/\r?\n/)) {
    // 与旧实现一致：不要求时间戳在行首（`作词：[00:12]某某` 也取得到），
    // 只是把连续的整组时间戳逐个展开。
    const start = rawLine.search(SINGLE_TIMESTAMP)
    if (start < 0) continue
    SINGLE_TIMESTAMP.lastIndex = 0
    const leading = LEADING_TIMESTAMPS.exec(rawLine.slice(start))
    if (!leading) continue
    // 去掉全部时间戳后剩下的正文；行内其余 `[..]` 若仍是时间戳也一并剥掉。
    let text = rawLine
      .slice(start + leading[0].length)
      .replace(SINGLE_TIMESTAMP, '')
      .trim()
    if (!text) continue
    const background = BACKGROUND_LINE.exec(text)
    if (background) text = background[1].trim()
    if (!text) continue
    const isBG = Boolean(background)

    SINGLE_TIMESTAMP.lastIndex = 0
    for (const match of leading[0].matchAll(SINGLE_TIMESTAMP)) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
      lines.push({ time: minutes * 60 + seconds + ms / 1000, text, isBG })
    }
  }

  // 稳定排序：同一时刻的多行（如对唱叠行）保持源文件顺序。
  return lines
    .map((line, index) => ({ line, index }))
    .sort((left, right) => left.line.time - right.line.time || left.index - right.index)
    .map(({ line }) => line)
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
      isBG: line.isBG,
      isDuet: false,
    }
  })
}

/** LRC 文本 → AMLL 行（原文 + 可选译文）。 */
export function buildAMLLLinesFromLrc(lyric: string, tlyric: string): AMLLLyricLine[] {
  return toAMLLLines(mergeLyrics(lyric, tlyric))
}
