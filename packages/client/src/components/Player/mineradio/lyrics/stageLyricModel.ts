import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'

/**
 * 把播发链路产出的 AMLL 歌词行规范化为 WebGL 舞台可消费的结构。
 *
 * 本模块是纯计算：不依赖 DOM、three.js 或任何 store，
 * 因此可以直接写单元测试。
 *
 * 关键职责：
 * 1. 为每个字计算字符区间（c0/c1）—— AMLL 的 LyricWord 没有这个字段，
 *    但 Mineradio 的逐字插值依赖它，因此这里按顺序累加得到等价区间。
 * 2. 保留 isDuet / isBG / 译词 / 音译等本项目已有语义。
 */

export interface StageWord {
  text: string
  startTime: number
  /** 毫秒 */
  endTime: number
  /** 字符区间起点（等价于 Mineradio 的 w.c0） */
  charStart: number
  /** 字符区间终点（等价于 Mineradio 的 w.c1） */
  charEnd: number
  romanWord: string
  obscene: boolean
}

export type StageLineRole = 'main' | 'background'

export interface StageLine {
  /** 在原始数组中的索引，用于点击跳转反查 */
  index: number
  text: string
  startTime: number
  endTime: number
  words: StageWord[]
  translation: string
  roman: string
  /** 对唱行靠右对齐 */
  isDuet: boolean
  role: StageLineRole
  charCount: number
  /**
   * 附属的背景歌词行索引（紧随其后、按 AMLL 规则折叠后仅保留一个）。
   * 无背景行时为 -1。
   */
  backgroundIndex: number
}

/**
 * AMLL 的背景行折叠规则：
 * 连续多个 isBG 行只保留第一个，其余降级为普通行。
 *
 * 与 `@applemusic-like-lyrics/core` 的 optimizeLyricLines 保持一致：
 *   if (line.isBG) { if (++consecutiveBgCount > 1) line.isBG = false } else consecutiveBgCount = 0
 */
export function foldConsecutiveBackgroundLines(lines: readonly AMLLLyricLine[]): boolean[] {
  const isBackground: boolean[] = []
  let consecutiveBgCount = 0

  for (const line of lines) {
    if (line.isBG) {
      consecutiveBgCount++
      isBackground.push(consecutiveBgCount <= 1)
    } else {
      consecutiveBgCount = 0
      isBackground.push(false)
    }
  }

  return isBackground
}

/** 把一行歌词转换为舞台行，同时累加字符区间。 */
function buildStageLine(line: AMLLLyricLine, index: number, isBackground: boolean): StageLine {
  const words: StageWord[] = []
  let cursor = 0

  for (const word of line.words) {
    const text = word.word ?? ''
    const charStart = cursor
    cursor += text.length

    words.push({
      text,
      startTime: word.startTime,
      endTime: word.endTime,
      charStart,
      charEnd: cursor,
      romanWord: word.romanWord ?? '',
      obscene: Boolean(word.obscene),
    })
  }

  // charCount 为 0 时退化为按字数平分，避免除零
  const charCount = Math.max(1, cursor)

  return {
    index,
    text: line.words.map((w) => w.word).join(''),
    startTime: line.startTime,
    endTime: line.endTime,
    words,
    translation: line.translatedLyric ?? '',
    roman: line.romanLyric ?? '',
    isDuet: Boolean(line.isDuet),
    role: isBackground ? 'background' : 'main',
    charCount,
    backgroundIndex: -1,
  }
}

/**
 * 把 AMLL 歌词行转换为舞台行列表。
 *
 * 背景行会被挂到前一个主行上（AMLL 语义：背景行依附于主行，主行激活时显示），
 * 并从主列表中移除，因此渲染栈只会遍历主行。
 */
export function buildStageLines(lines: readonly AMLLLyricLine[] | null | undefined): StageLine[] {
  if (!lines || lines.length === 0) return []

  const backgroundFlags = foldConsecutiveBackgroundLines(lines)
  const stageLines: StageLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isBackground = backgroundFlags[i]

    // 背景行挂到最近的前一个主行，不独立进入渲染栈
    if (isBackground) {
      for (let j = stageLines.length - 1; j >= 0; j--) {
        if (stageLines[j].role === 'main') {
          // 每个主行下方最多一个背景行；已占用则跳过（防御异常数据）
          if (stageLines[j].backgroundIndex === -1) {
            const bg = buildStageLine(line, i, true)
            stageLines.push(bg)
            stageLines[j].backgroundIndex = stageLines.length - 1
          }
          break
        }
      }
      continue
    }

    stageLines.push(buildStageLine(line, i, false))
  }

  return stageLines
}

/**
 * 计算某一行的逐字进度（0..1）。
 *
 * 与 Mineradio 的 getLyricLineProgress 行为一致：
 * 无逐字数据时回退为整行平滑推进。
 *
 * @param nowSeconds 当前播放时间（秒，已含偏移校准）
 */
export function computeLineProgress(line: StageLine, nowSeconds: number, fallbackEndSeconds: number): number {
  const { words, charCount } = line

  // 有真正的逐字时间轴时按字符区间插值
  if (words.length > 0 && hasWordTiming(words)) {
    let lastProgress = 0

    for (const word of words) {
      const startSeconds = word.startTime / 1000
      const endSeconds = word.endTime / 1000

      if (nowSeconds < startSeconds) return lastProgress

      const span = Math.max(0.08, endSeconds - startSeconds)
      const local = nowSeconds >= endSeconds ? 1 : Math.max(0, Math.min(1, (nowSeconds - startSeconds) / span))

      const p0 = word.charStart / charCount
      const p1 = word.charEnd / charCount
      const progress = p0 + (p1 - p0) * local

      lastProgress = Math.max(lastProgress, progress)
      if (nowSeconds < endSeconds) return lastProgress
    }

    return 1
  }

  // 回退：整行在 [startTime, 下一行/估算结束] 之间平滑推进
  const startSeconds = line.startTime / 1000
  const endCandidate = line.endTime > line.startTime ? line.endTime / 1000 : fallbackEndSeconds
  const span = Math.max(0.75, endCandidate - startSeconds)
  const raw = Math.max(0, Math.min(1, (nowSeconds - startSeconds) / span))
  // smoothstep，与上游的 prog * prog * (3 - 2 * prog) 一致
  return raw * raw * (3 - 2 * raw)
}

/**
 * 判断这些字是否带有真实的逐字时间轴。
 *
 * AMLL 在纯 LRC 回退时会把整行做成**一个** word，其起止时间等于整行时间；
 * 那种情况按整行推进更自然，因此这里必须排除掉。
 *
 * 判定依据是"存在内部时间边界"：只要有一对相邻字满足
 * `words[i].endTime < words[i+1].startTime` 或时间不连续，
 * 就说明时间轴是逐字标注的，而不是整行退化。
 */
export function hasWordTiming(words: readonly StageWord[]): boolean {
  if (words.length === 0) return false

  // 多字且时间轴覆盖多个区间 → 真正的逐字
  if (words.length > 1) {
    // 至少存在一个字的结束时间早于另一个字的开始时间，
    // 或两个字的区间彼此不同，才认为有逐字信息。
    const first = words[0]
    const last = words[words.length - 1]
    const spansWholeLine = first.startTime === last.startTime && first.endTime === last.endTime
    if (spansWholeLine) return false

    // 所有字共享同一组起止时间同样视为无逐字（整行退化）
    const allIdentical = words.every((w) => w.startTime === first.startTime && w.endTime === first.endTime)
    return !allIdentical
  }

  // 单个字无法表达逐字信息，一律按整行推进
  return false
}

/** 找出当前激活的主行索引（在 stageLines 中的下标），无匹配返回 -1。 */
/**
 * 主行下标的缓存（第三十四轮性能修复，§5.4 D4）。
 *
 * `findActiveLineIndex` 在 **WebGL 歌词的逐帧循环**里被调用（第 31 轮起读逐帧
 * 时钟），原来每次都对整条轨道线性扫描。120 行的歌即 7200 次比较/秒。
 *
 * 主行下标表只随 `lines` 数组本身变化，因此按**引用**缓存：
 * 轨道重建时 `stageLines` 是新数组，缓存自动失效。
 * 只保留最后一份 —— 同时只有一条轨道在用。
 */
let mainIndexCacheFor: readonly StageLine[] | null = null
let mainIndexCache: number[] = []

function mainLineIndices(lines: readonly StageLine[]): number[] {
  if (mainIndexCacheFor === lines) return mainIndexCache
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].role === 'main') out.push(i)
  }
  mainIndexCacheFor = lines
  mainIndexCache = out
  return out
}

export function findActiveLineIndex(lines: readonly StageLine[], nowSeconds: number): number {
  // ★ 二分查找：在**主行**下标表上找"最后一个 startTime ≤ now"的主行。
  //
  //   ★ 这是**等价**变换而非近似 —— 原实现的 `else break` 本身就依赖
  //     "主行按 startTime 递增"，与二分要求的单调性是**同一条不变量**。
  //     若该前提被破坏，原实现会提前 break 掉后面的命中、同样是错的，
  //     因此本改动不引入新前提。
  //
  //   背景行（`role !== 'main'`）插在主行之后，必须先滤掉再二分 ——
  //   在原始下标上直接二分是错的（合格下标集合不是连续区间）。
  const main = mainLineIndices(lines)
  let lo = 0
  let hi = main.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[main[mid]].startTime / 1000 <= nowSeconds) {
      result = main[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
