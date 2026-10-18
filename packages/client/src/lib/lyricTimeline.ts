import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core'

/**
 * 一行 LRC 的**全部**时间戳与其后的正文。
 *
 * ★ 一行可带多个时间戳（`[00:12.00][01:30.00]副歌`）：同一句在两处各唱一遍。
 *   只取第一个会让后一个时刻没有行（上一行被拉长到它之后，画面停住），
 *   并把 `[01:30.00]` 留在正文里 —— 显示出来、还被算进字符数污染打分。
 */
const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_LINE_PATTERN = /^(?:\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\])+/
const SPEAKER_PREFIX_PATTERN = /^[^:：]{1,16}[:：]\s*/
const LYRIC_CREDIT_PATTERN =
  /^(?:作?词|作?曲|编曲|制作人|监制|混音|母带|录音(?:师|棚)?|封面设计|吉他|贝斯|鼓|弦乐|和声|发行|出品|op|sp|isrc)\s*[:：]/iu

interface LyricCandidate {
  words: LyricWord[]
  startTime: number
  endTime: number
  normalizedText: string
  hasWordTiming: boolean
  /** 背景人声行：不参与行序配对，但可以回填背景标志。 */
  isBG: boolean
}

interface TimedLyricText {
  text: string
  startTime: number
  normalizedText: string
}

export interface LyricAuxiliarySource {
  lyric?: string
  tlyric?: string
  romalrc?: string
  lines?: readonly LyricLine[]
}

export interface LyricAuxiliaryResult {
  lines: LyricLine[]
  changed: boolean
  translationCoverage: number
  romanCoverage: number
}

export interface LyricStructureResult {
  lines: LyricLine[]
  changed: boolean
}

export interface LyricRepairSource {
  lrc?: string
  wordByWord?: readonly LyricLine[]
}

export interface LyricTimelineResult {
  lines: LyricLine[]
  unresolvedCount: number
}

export interface LyricAnimationQuality {
  hasWordAnimation: boolean
  confidence: number
  animationCoverage: number
  repeatedSectionCoverage: number
  textCoverage: number
  validTimingCoverage: number
  meaningfulCharacterCount: number
  duetLineCount: number
  backgroundLineCount: number
}

/** 两个时间轴之间的一致程度。 */
export interface LyricTimelineAgreement {
  /** 实测偏移（毫秒，正数表示 `lines` 相对 `reference` 更晚）。 */
  offset: number
  /** 参与中位数的样本数；越大越可信。 */
  support: number
  /**
   * 一致性 0–1：偏移扣除后，两轴在该偏移附近的样本占多大比例。
   * 样本不足时为 `null` —— 没有证据，不能当作"一致"。
   */
  agreement: number | null
}

/** 两轴被判为"同一时间轴"的容差（毫秒）。 */
const TIMELINE_AGREEMENT_TOLERANCE_MS = 120
/** 参与一致性统计所需的最小样本数。 */
const TIMELINE_AGREEMENT_MIN_SUPPORT = 4

interface LyricGroup {
  lines: LyricLine[]
  originalIndex: number
  startTime: number
}

function isValidRange(startTime: number, endTime: number): boolean {
  return Number.isFinite(startTime) && Number.isFinite(endTime) && startTime >= 0 && endTime > startTime
}

function normalizeLyricText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SPEAKER_PREFIX_PATTERN, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function lineText(line: LyricLine): string {
  return line.words.map((word) => word.word).join('')
}

interface LrcTimedLine {
  text: string
  startTime: number
  isBG: boolean
}

const LRC_BACKGROUND_LINE = /^[(（](.+)[)）]$/

/**
 * 逐行解析 LRC：每一行按它携带的**全部**时间戳展开成多条记录。
 *
 * 行内正文里残留的时间戳（部分平台把时间戳写在正文中间）一并剥掉，
 * 保证 `text` 只含真正的歌词字符 —— 否则它会被显示出来，也会混进
 * `normalizeLyricText` 的字符数里污染打分。
 *
 * 整行被括号包住即背景人声（上游 `parseLrc` 的 `bgRegex` 同语义），括号要剥掉：
 * 上游解析器同样剥，不剥会让同一句在两个源里无法按文本配对。
 */
function parseLrcLines(lrc: string): LrcTimedLine[] {
  const parsed: LrcTimedLine[] = []

  for (const rawLine of lrc.split(/\r?\n/)) {
    // 旧实现不锚定行首：时间戳写在行中间（`作词：[00:12]某某`）也能取到。
    // 这里保持同一语义 —— 从第一个时间戳起算，只是把**连续的**整组都展开。
    const start = rawLine.search(LRC_TIMESTAMP_PATTERN)
    if (start < 0) continue
    const leading = LRC_LINE_PATTERN.exec(rawLine.slice(start))
    if (!leading) continue
    let text = rawLine
      .slice(start + leading[0].length)
      .replace(LRC_TIMESTAMP_PATTERN, '')
      .trim()
    if (!text) continue
    const background = LRC_BACKGROUND_LINE.exec(text)
    if (background) text = background[1].trim()
    if (!text) continue
    const isBG = Boolean(background)

    LRC_TIMESTAMP_PATTERN.lastIndex = 0
    for (const match of leading[0].matchAll(LRC_TIMESTAMP_PATTERN)) {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const milliseconds = match[3] ? Number(match[3].padEnd(3, '0')) : 0
      parsed.push({ text, startTime: (minutes * 60 + seconds) * 1_000 + milliseconds, isBG })
    }
  }

  // 稳定排序：同一时刻的多行保持源文件顺序。
  return parsed
    .map((line, index) => ({ line, index }))
    .sort((left, right) => left.line.startTime - right.line.startTime || left.index - right.index)
    .map(({ line }) => line)
}

function parseTimedLyricText(lrc: string): TimedLyricText[] {
  return parseLrcLines(lrc).flatMap(({ text, startTime }) => {
    const normalizedText = normalizeLyricText(text)
    return normalizedText ? [{ text, normalizedText, startTime }] : []
  })
}

function countNormalizedCharacters(value: string): number {
  return normalizeLyricText(value).length
}

function referenceText(lrc: string): string {
  return referenceLines(lrc).join('')
}

function referenceLines(lrc: string): string[] {
  // 按时间戳展开（多时间戳行算作它实际被唱到的次数），署名行不参与比对。
  return parseLrcLines(lrc).flatMap(({ text }) => {
    if (LYRIC_CREDIT_PATTERN.test(text)) return []
    const normalized = normalizeLyricText(text)
    return normalized ? [normalized] : []
  })
}

/** Line wrapping differs between providers, so compare the ordered lyric text rather than exact lines. */
function orderedTextCoverage(candidate: string, reference: string): number {
  if (!reference) return candidate ? 1 : 0
  if (!candidate) return 0

  const row = new Uint16Array(reference.length + 1)
  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex++) {
    let diagonal = 0
    for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex++) {
      const previous = row[referenceIndex]
      row[referenceIndex] =
        candidate[candidateIndex] === reference[referenceIndex - 1]
          ? diagonal + 1
          : Math.max(row[referenceIndex], row[referenceIndex - 1])
      diagonal = previous
    }
  }
  return row[reference.length] / reference.length
}

/**
 * Scores actual word animation data rather than trusting the source format.
 * A candidate must be substantially animated, correctly timed, and complete
 * enough compared with the provider's main LRC before it can outrank a
 * structurally richer line-timed source.
 */
export function evaluateLyricAnimationQuality(
  lines: readonly LyricLine[],
  referenceLrc = '',
  comparisonCharacterCount = 0,
): LyricAnimationQuality {
  let meaningfulCharacterCount = 0
  let animatedCharacterCount = 0
  let validTimingCharacterCount = 0
  let meaningfulLineCount = 0
  let animatedLineCount = 0
  let duetLineCount = 0
  let backgroundLineCount = 0
  const candidateLines: Array<{ text: string; animated: boolean }> = []

  for (const line of lines) {
    const normalizedLine = normalizeLyricText(lineText(line))
    if (!normalizedLine) continue
    meaningfulLineCount += 1
    if (line.isDuet) duetLineCount += 1
    if (line.isBG) backgroundLineCount += 1
    meaningfulCharacterCount += normalizedLine.length

    const meaningfulWords = line.words.filter((word) => countNormalizedCharacters(word.word) > 0)
    const timedWords = meaningfulWords.filter((word) => isValidRange(word.startTime, word.endTime))
    validTimingCharacterCount += timedWords.reduce((total, word) => total + countNormalizedCharacters(word.word), 0)

    const distinctTimings = new Set(timedWords.map((word) => `${word.startTime}:${word.endTime}`))
    if (timedWords.length >= 2 && distinctTimings.size >= 2) {
      animatedLineCount += 1
      animatedCharacterCount += normalizedLine.length
      candidateLines.push({ text: normalizedLine, animated: true })
    } else {
      candidateLines.push({ text: normalizedLine, animated: false })
    }
  }

  const animationCoverage =
    meaningfulCharacterCount > 0 ? Math.min(1, animatedCharacterCount / meaningfulCharacterCount) : 0
  const validTimingCoverage =
    meaningfulCharacterCount > 0 ? Math.min(1, validTimingCharacterCount / meaningfulCharacterCount) : 0
  const normalizedReferenceText = referenceText(referenceLrc)
  const textCoverage =
    normalizedReferenceText.length > 0
      ? orderedTextCoverage(candidateLines.map((line) => line.text).join(''), normalizedReferenceText)
      : comparisonCharacterCount > 0
        ? Math.min(1, meaningfulCharacterCount / comparisonCharacterCount)
        : meaningfulCharacterCount > 0
          ? 1
          : 0

  const repeatedReferenceCounts = new Map<string, number>()
  for (const text of referenceLines(referenceLrc)) {
    if (Array.from(text).length < 4) continue
    repeatedReferenceCounts.set(text, (repeatedReferenceCounts.get(text) ?? 0) + 1)
  }
  let repeatedCharacterCount = 0
  let animatedRepeatedCharacterCount = 0
  for (const [text, count] of repeatedReferenceCounts) {
    if (count < 2) continue
    const characterCount = Array.from(text).length
    const animatedMatches = candidateLines.filter((line) => line.animated && textMatchScore(line.text, text) > 0).length
    repeatedCharacterCount += characterCount * count
    animatedRepeatedCharacterCount += characterCount * Math.min(count, animatedMatches)
  }
  const repeatedSectionCoverage =
    repeatedCharacterCount >= 20 ? animatedRepeatedCharacterCount / repeatedCharacterCount : 1

  const requiredAnimatedLines = Math.min(3, Math.max(1, Math.ceil(meaningfulLineCount * 0.1)))
  const hasWordAnimation =
    animatedLineCount >= requiredAnimatedLines &&
    animationCoverage >= 0.55 &&
    repeatedSectionCoverage >= 0.6 &&
    validTimingCoverage >= 0.85 &&
    textCoverage >= 0.8
  const confidence = Math.min(
    1,
    animationCoverage * 0.4 + textCoverage * 0.25 + validTimingCoverage * 0.2 + repeatedSectionCoverage * 0.15,
  )

  return {
    hasWordAnimation,
    confidence,
    animationCoverage,
    repeatedSectionCoverage,
    textCoverage,
    validTimingCoverage,
    meaningfulCharacterCount,
    duetLineCount,
    backgroundLineCount,
  }
}

function parseLrcCandidates(lrc: string): LyricCandidate[] {
  const parsed = parseLrcLines(lrc)

  return parsed.map((line, index) => {
    const endTime = Math.max(line.startTime + 800, parsed[index + 1]?.startTime ?? line.startTime + 1_500)
    return {
      words: [
        {
          word: line.text.replace(SPEAKER_PREFIX_PATTERN, ''),
          startTime: line.startTime,
          endTime,
          romanWord: '',
          obscene: false,
        },
      ],
      startTime: line.startTime,
      endTime,
      normalizedText: normalizeLyricText(line.text),
      hasWordTiming: false,
      isBG: line.isBG,
    }
  })
}

function wordByWordCandidates(lines: readonly LyricLine[]): LyricCandidate[] {
  return lines.flatMap((line) => {
    if (!isValidRange(line.startTime, line.endTime) || line.words.length === 0) return []
    return [
      {
        words: line.words.map((word) => ({ ...word })),
        startTime: line.startTime,
        endTime: line.endTime,
        normalizedText: normalizeLyricText(lineText(line)),
        hasWordTiming: true,
        isBG: line.isBG ?? false,
      },
    ]
  })
}

function estimateTimelineOffset(lines: readonly LyricLine[], candidates: readonly LyricCandidate[]): number {
  const { offset, support } = measureTimelineOffset(lines, candidates)
  // 保持原契约：样本不足 3 条时按"没有测到偏移"处理，不拿一两条噪声去挪对齐窗口。
  return support >= 3 ? offset : 0
}

/**
 * 估计 `lines` 相对 `candidates` 的整体时间偏移（毫秒，正数表示 lines 更晚）。
 *
 * 只用**唯一文本**配对的旧做法在副歌重复 3~4 遍的流行歌上经常凑不满样本，
 * 于是偏移恒为 0，翻译/罗马音只能在 ±6s 的宽容差里乱配。这里改为：
 *
 *   ① 唯一文本行直接配对（最可信）；
 *   ② 剩不下足够样本时，退到**按行序配对**：两侧都是时间有序的主行序列，
 *      同下标相减再取中位数 —— 重复段落因此也能贡献样本。
 *
 * `support` 是参与中位数的样本数，消费方可据此判断这次估计是否可信。
 */
function measureTimelineOffset(
  lines: readonly LyricLine[],
  candidates: readonly LyricCandidate[],
): { offset: number; support: number } {
  const lineTimes = new Map<string, number[]>()
  const candidateTimes = new Map<string, number[]>()

  for (const line of lines) {
    if (!isValidRange(line.startTime, line.endTime)) continue
    const text = normalizeLyricText(lineText(line))
    if (!text) continue
    lineTimes.set(text, [...(lineTimes.get(text) ?? []), line.startTime])
  }
  for (const candidate of candidates) {
    if (!candidate.normalizedText) continue
    candidateTimes.set(candidate.normalizedText, [
      ...(candidateTimes.get(candidate.normalizedText) ?? []),
      candidate.startTime,
    ])
  }

  const differences: number[] = []
  for (const [text, sourceTimes] of candidateTimes) {
    const targetTimes = lineTimes.get(text)
    if (sourceTimes.length !== 1 || targetTimes?.length !== 1) continue
    const difference = targetTimes[0] - sourceTimes[0]
    if (Math.abs(difference) <= 3_000) differences.push(difference)
  }
  // 文本配对是最可信的证据，够 3 条就直接用。
  if (differences.length >= 3) return { offset: median(differences), support: differences.length }

  // 退路：按行序配对。两侧都滤掉背景行并保持时间有序，同下标即同一句 ——
  // 重复副歌因此也能贡献样本。行数差太多说明有一侧缺行/多行，下标不再对位，
  // 这时宁可放弃也不给出错误的正值。
  const orderedLines = lines.filter((line) => !line.isBG && isValidRange(line.startTime, line.endTime))
  // 两侧必须用同一条过滤规则，否则背景行会让一侧的下标整体偏移。
  const orderedCandidates = candidates.filter((candidate) => candidate.normalizedText && !candidate.isBG)
  const paired = Math.min(orderedLines.length, orderedCandidates.length)
  const lengthGap = Math.abs(orderedLines.length - orderedCandidates.length)
  if (paired < 3 || lengthGap > Math.max(2, Math.ceil(paired * 0.1))) {
    return { offset: differences.length ? median(differences) : 0, support: differences.length }
  }

  const positional: number[] = []
  for (let index = 0; index < paired; index += 1) {
    const difference = orderedLines[index].startTime - orderedCandidates[index].startTime
    if (Math.abs(difference) <= 5_000) positional.push(difference)
  }
  if (positional.length < 3) return { offset: differences.length ? median(differences) : 0, support: differences.length }
  return { offset: median(positional), support: positional.length }
}

/** 中位数（就地排序副本）。 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * 比对两套歌词时间轴，给出它们的整体偏移与一致程度。
 *
 * ============================ 为什么需要这个 ============================
 *
 * `evaluateLyricAnimationQuality` 的四个分量里**没有时间维度**:
 * `textCoverage` 是忽略时间戳的有序字符 LCS，`validTimingCoverage` 只看
 * 区间"格式合法"。因此「逐字完美但整首晚 400ms」与「逐字完美且对齐」
 * 得分完全相同 —— 选源实际上是在比格式质量，不是在比对齐质量。
 *
 * 这里补上那一维：两个候选都给出时，先用文本配对（或按行序退路）实测
 * 它们的整体偏移，再统计扣除该偏移后有多少行落在容差内。消费方据此：
 *
 *   · 两轴**一致** → 现有评分已经够用，不必干预；
 *   · 两轴**不一致** → 没有第三方真值可判谁对，此时应当**避免中途换源**
 *     （换源会让当前行突然前跳/后跳），而不是猜一个更"对"的。
 *
 * 只有两个源时 `agreement` 的含义是"它们是不是同一条时间轴"，而不是
 * "哪条对" —— 后者需要音频强制对齐，本项目没有那条数据源。
 */
export function measureTimelineAgreement(
  lines: readonly LyricLine[],
  reference: readonly LyricLine[],
): LyricTimelineAgreement {
  const toCandidates = (source: readonly LyricLine[]): LyricCandidate[] =>
    source.flatMap((line) => {
      if (!isValidRange(line.startTime, line.endTime)) return []
      const normalizedText = normalizeLyricText(lineText(line))
      if (!normalizedText) return []
      return [
        {
          words: [],
          startTime: line.startTime,
          endTime: line.endTime,
          normalizedText,
          hasWordTiming: line.words.length > 1,
          isBG: line.isBG ?? false,
        },
      ]
    })

  const candidates = toCandidates(reference)
  const { offset, support } = measureTimelineOffset(lines, candidates)
  if (support < TIMELINE_AGREEMENT_MIN_SUPPORT) return { offset, support, agreement: null }

  // 扣除偏移后，逐行判断最近的一条参考行是否落在容差内。两侧都按时间
  // 预排序，用游标推进（两侧时间都单调，指针不会回退）。
  // 背景行两侧都要排除：`ownTimes` 已经滤掉，参考侧若留着，会为它算出一份
  // 并不存在的"命中"，把一致度虚抬上去。
  const referenceTimes = candidates
    .filter((candidate) => !candidate.isBG)
    .map((candidate) => candidate.startTime)
    .sort((left, right) => left - right)
  const ownTimes = lines
    .filter((line) => !line.isBG && isValidRange(line.startTime, line.endTime))
    .map((line) => line.startTime)
    .sort((left, right) => left - right)
  if (ownTimes.length === 0 || referenceTimes.length === 0) return { offset, support, agreement: null }

  const nearestDistance = (time: number): number => {
    let low = 0
    let high = referenceTimes.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (referenceTimes[mid] < time) low = mid + 1
      else high = mid
    }
    const after = Math.abs(referenceTimes[low] - time)
    const before = low > 0 ? Math.abs(referenceTimes[low - 1] - time) : after
    return Math.min(after, before)
  }

  let matched = 0
  for (const time of ownTimes) {
    if (nearestDistance(time - offset) <= TIMELINE_AGREEMENT_TOLERANCE_MS) matched += 1
  }

  return { offset, support, agreement: matched / ownTimes.length }
}

function auxiliaryCoverage(lines: readonly LyricLine[], field: 'translatedLyric' | 'romanLyric'): number {
  const meaningfulLines = lines.filter((line) => !line.isBG && normalizeLyricText(lineText(line)))
  if (meaningfulLines.length === 0) return 1
  return meaningfulLines.filter((line) => line[field]?.trim()).length / meaningfulLines.length
}

function pairAuxiliaryLines(original: readonly TimedLyricText[], auxiliaryLrc: string): string[] {
  const auxiliary = parseTimedLyricText(auxiliaryLrc)
  if (auxiliary.length === 0) return []

  let auxiliaryIndex = 0
  return original.map((line) => {
    while (auxiliaryIndex < auxiliary.length && auxiliary[auxiliaryIndex].startTime < line.startTime - 1_500) {
      auxiliaryIndex += 1
    }
    let bestIndex = -1
    let bestDistance = 1_501
    for (let candidateIndex = auxiliaryIndex; candidateIndex < auxiliary.length; candidateIndex++) {
      const candidate = auxiliary[candidateIndex]
      const distance = Math.abs(candidate.startTime - line.startTime)
      if (distance < bestDistance) {
        bestIndex = candidateIndex
        bestDistance = distance
      }
      if (candidate.startTime > line.startTime + 1_500) break
    }
    if (bestIndex < 0) return ''
    auxiliaryIndex = bestIndex + 1
    return auxiliary[bestIndex].text
  })
}

function textMatchScore(target: string, source: string): number {
  if (target === source) return 1
  const targetCharacters = Array.from(target)
  const sourceCharacters = Array.from(source)
  const shorter = Math.min(targetCharacters.length, sourceCharacters.length)
  const longer = Math.max(targetCharacters.length, sourceCharacters.length)
  if (shorter < 3) return 0

  const row = new Uint16Array(sourceCharacters.length + 1)
  for (const targetCharacter of targetCharacters) {
    let diagonal = 0
    for (let sourceIndex = 1; sourceIndex <= sourceCharacters.length; sourceIndex++) {
      const previous = row[sourceIndex]
      row[sourceIndex] =
        targetCharacter === sourceCharacters[sourceIndex - 1]
          ? diagonal + 1
          : Math.max(row[sourceIndex], row[sourceIndex - 1])
      diagonal = previous
    }
  }
  const commonLength = row[sourceCharacters.length]
  const shorterCoverage = commonLength / shorter
  const longerCoverage = commonLength / longer
  if (shorterCoverage < 0.88 || longerCoverage < 0.42) return 0
  return 0.55 + longerCoverage * 0.4
}

function alignAuxiliarySource(
  lines: readonly LyricLine[],
  original: readonly TimedLyricText[],
): { mapping: number[]; offset: number } {
  const targets = lines.flatMap((line, lineIndex) => {
    const normalizedText = normalizeLyricText(lineText(line))
    return !line.isBG && isValidRange(line.startTime, line.endTime) && normalizedText
      ? [{ lineIndex, startTime: line.startTime, normalizedText }]
      : []
  })
  const candidates: LyricCandidate[] = original.map((line) => ({
    words: [],
    startTime: line.startTime,
    endTime: line.startTime + 1_500,
    normalizedText: line.normalizedText,
    hasWordTiming: false,
    isBG: false,
  }))
  const offset = estimateTimelineOffset(lines, candidates)
  const width = original.length + 1
  const scores = new Float32Array((targets.length + 1) * width)
  const decisions = new Uint8Array((targets.length + 1) * width)

  for (let targetIndex = 1; targetIndex <= targets.length; targetIndex++) {
    const target = targets[targetIndex - 1]
    for (let sourceIndex = 1; sourceIndex <= original.length; sourceIndex++) {
      const cell = targetIndex * width + sourceIndex
      const skipTarget = scores[(targetIndex - 1) * width + sourceIndex]
      const skipSource = scores[targetIndex * width + sourceIndex - 1]
      if (skipTarget >= skipSource) {
        scores[cell] = skipTarget
        decisions[cell] = 1
      } else {
        scores[cell] = skipSource
        decisions[cell] = 2
      }

      const timeDistance = Math.abs(target.startTime - (original[sourceIndex - 1].startTime + offset))
      const tolerance = 6_000
      if (timeDistance > tolerance) continue
      const matchScore = textMatchScore(target.normalizedText, original[sourceIndex - 1].normalizedText)
      if (matchScore === 0) continue
      const alignedScore =
        scores[(targetIndex - 1) * width + sourceIndex - 1] + matchScore * 10 + 1 - timeDistance / tolerance
      if (alignedScore > scores[cell]) {
        scores[cell] = alignedScore
        decisions[cell] = 3
      }
    }
  }

  const mapping = new Array<number>(lines.length).fill(-1)
  let targetIndex = targets.length
  let sourceIndex = original.length
  while (targetIndex > 0 && sourceIndex > 0) {
    const decision = decisions[targetIndex * width + sourceIndex]
    if (decision === 3) {
      mapping[targets[targetIndex - 1].lineIndex] = sourceIndex - 1
      targetIndex -= 1
      sourceIndex -= 1
    } else if (decision === 2) {
      sourceIndex -= 1
    } else {
      targetIndex -= 1
    }
  }
  return { mapping, offset }
}

interface PreparedAuxiliarySource {
  original: TimedLyricText[]
  translations: string[]
  romanizations: string[]
  alignment: ReturnType<typeof alignAuxiliarySource>
  order: number
}

function completeAuxiliaryMapping(
  lines: readonly LyricLine[],
  source: PreparedAuxiliarySource,
  values: readonly string[],
): number[] {
  const mapping = [...source.alignment.mapping]
  const matchedCount = mapping.filter((sourceIndex) => sourceIndex >= 0).length
  if (matchedCount < Math.min(8, Math.ceil(source.original.length * 0.2))) return mapping

  const usedSources = new Set(mapping.filter((sourceIndex) => sourceIndex >= 0))
  for (let sourceIndex = 0; sourceIndex < source.original.length; sourceIndex++) {
    if (usedSources.has(sourceIndex) || !values[sourceIndex]) continue
    let previousTarget = -1
    for (let lineIndex = mapping.length - 1; lineIndex >= 0; lineIndex--) {
      if (mapping[lineIndex] >= 0 && mapping[lineIndex] < sourceIndex) {
        previousTarget = lineIndex
        break
      }
    }
    const nextTarget = mapping.findIndex((mappedSource) => mappedSource > sourceIndex)
    const upperBound = nextTarget < 0 ? mapping.length : nextTarget
    let bestTarget = -1
    let bestDistance = 6_001
    for (let lineIndex = previousTarget + 1; lineIndex < upperBound; lineIndex++) {
      const line = lines[lineIndex]
      if (mapping[lineIndex] >= 0 || line.isBG || !isValidRange(line.startTime, line.endTime)) continue
      const distance = Math.abs(line.startTime - (source.original[sourceIndex].startTime + source.alignment.offset))
      if (distance < bestDistance) {
        bestDistance = distance
        bestTarget = lineIndex
      }
    }
    if (bestTarget >= 0) {
      mapping[bestTarget] = sourceIndex
      usedSources.add(sourceIndex)
    }
  }
  return mapping
}

function auxiliarySourceScore(source: PreparedAuxiliarySource, values: readonly string[]): number {
  const availableCount = values.filter(Boolean).length
  if (availableCount === 0) return -1
  const matchedCount = source.alignment.mapping.filter((sourceIndex) => sourceIndex >= 0 && values[sourceIndex]).length
  return matchedCount + matchedCount / availableCount
}

/** Conservatively carries verified AMLL duet/background flags onto a better word timeline. */
export function enrichLyricStructure(
  lines: readonly LyricLine[],
  structuralLines: readonly LyricLine[],
): LyricStructureResult {
  const enriched = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const sourceEntries = structuralLines.flatMap((line) => {
    const text = lineText(line).trim()
    const normalizedText = normalizeLyricText(text)
    return isValidRange(line.startTime, line.endTime) && normalizedText
      ? [{ line, original: { text, normalizedText, startTime: line.startTime } }]
      : []
  })
  if (sourceEntries.length === 0) return { lines: enriched, changed: false }

  const alignment = alignAuxiliarySource(
    enriched,
    sourceEntries.map((entry) => entry.original),
  )
  const matchedCount = alignment.mapping.filter((sourceIndex) => sourceIndex >= 0).length
  if (matchedCount < Math.min(3, Math.ceil(sourceEntries.length * 0.2))) {
    return { lines: enriched, changed: false }
  }

  let changed = false
  for (let lineIndex = 0; lineIndex < enriched.length; lineIndex++) {
    const sourceIndex = alignment.mapping[lineIndex]
    if (sourceIndex < 0) continue
    const source = sourceEntries[sourceIndex].line
    const target = enriched[lineIndex]
    if (source.isDuet && !target.isDuet) {
      target.isDuet = true
      changed = true
    }
    if (source.isBG && !target.isBG && lineIndex > 0 && !enriched[lineIndex - 1].isBG) {
      target.isBG = true
      changed = true
    }
  }
  return { lines: enriched, changed }
}

/**
 * Adds translation and romanization without changing AMLL's word timing,
 * duet/background structure, or existing auxiliary text.
 */
export function enrichLyricAuxiliary(
  lines: readonly LyricLine[],
  sources: readonly LyricAuxiliarySource[],
): LyricAuxiliaryResult {
  const enriched = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  let changed = false

  const preparedSources = sources.flatMap((source, order): PreparedAuxiliarySource[] => {
    const sourceLines =
      source.lines?.flatMap((line) => {
        const text = lineText(line).trim()
        const normalizedText = normalizeLyricText(text)
        return !line.isBG && isValidRange(line.startTime, line.endTime) && normalizedText
          ? [{ line, original: { text, normalizedText, startTime: line.startTime } }]
          : []
      }) ?? []
    const original =
      sourceLines.length > 0 ? sourceLines.map((entry) => entry.original) : parseTimedLyricText(source.lyric ?? '')
    if (original.length === 0) return []
    const translations =
      sourceLines.length > 0
        ? sourceLines.map((entry) => entry.line.translatedLyric?.trim() ?? '')
        : pairAuxiliaryLines(original, source.tlyric ?? '')
    const romanizations =
      sourceLines.length > 0
        ? sourceLines.map((entry) => entry.line.romanLyric?.trim() ?? '')
        : pairAuxiliaryLines(original, source.romalrc ?? '')
    if (!translations.some(Boolean) && !romanizations.some(Boolean)) return []
    return [
      {
        original,
        translations,
        romanizations,
        alignment: alignAuxiliarySource(enriched, original),
        order,
      },
    ]
  })

  for (const field of ['translatedLyric', 'romanLyric'] as const) {
    const valuesKey = field === 'translatedLyric' ? 'translations' : 'romanizations'
    const rankedSources = [...preparedSources].sort(
      (left, right) =>
        auxiliarySourceScore(right, right[valuesKey]) - auxiliarySourceScore(left, left[valuesKey]) ||
        left.order - right.order,
    )
    for (const source of rankedSources) {
      const values = source[valuesKey]
      if (!values.some(Boolean)) continue
      const mapping = completeAuxiliaryMapping(enriched, source, values)
      for (let lineIndex = 0; lineIndex < enriched.length; lineIndex++) {
        const sourceIndex = mapping[lineIndex]
        if (sourceIndex < 0 || enriched[lineIndex][field] || !values[sourceIndex]) continue
        enriched[lineIndex][field] = values[sourceIndex]
        changed = true
      }
    }
  }

  return {
    lines: enriched,
    changed,
    translationCoverage: auxiliaryCoverage(enriched, 'translatedLyric'),
    romanCoverage: auxiliaryCoverage(enriched, 'romanLyric'),
  }
}

export function needsLyricAuxiliary(lines: readonly LyricLine[]): boolean {
  const text = lines
    .filter((line) => !line.isBG)
    .map(lineText)
    .join('')
  const hasKoreanOrJapanese = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  const latinCount = text.match(/\p{Script=Latin}/gu)?.length ?? 0
  const cjkCount = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const mainlyLatin = latinCount >= 24 && latinCount > cjkCount
  if (!hasKoreanOrJapanese && !mainlyLatin) return false

  const translationCoverage = auxiliaryCoverage(lines, 'translatedLyric')
  const romanCoverage = auxiliaryCoverage(lines, 'romanLyric')
  return translationCoverage < 0.6 || (hasKoreanOrJapanese && romanCoverage < 0.6)
}

function repairInvalidLines(lines: readonly LyricLine[], sources: readonly LyricRepairSource[]): LyricLine[] {
  const repaired = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const invalidIndexes = repaired.flatMap((line, index) =>
    !isValidRange(line.startTime, line.endTime) &&
    !line.words.some((word) => isValidRange(word.startTime, word.endTime))
      ? [index]
      : [],
  )
  if (invalidIndexes.length === 0) return repaired

  const candidateGroups = sources.flatMap((source) => {
    const candidates = source.wordByWord?.length
      ? wordByWordCandidates(source.wordByWord)
      : source.lrc
        ? parseLrcCandidates(source.lrc)
        : []
    return candidates.length > 0 ? [{ candidates, offset: estimateTimelineOffset(repaired, candidates) }] : []
  })

  for (const invalidIndex of invalidIndexes) {
    const target = repaired[invalidIndex]
    const targetText = normalizeLyricText(lineText(target))
    if (!targetText) continue

    const previous = repaired
      .slice(0, invalidIndex)
      .reverse()
      .find((line) => isValidRange(line.startTime, line.endTime))
    const next = repaired.slice(invalidIndex + 1).find((line) => isValidRange(line.startTime, line.endTime))

    for (const group of candidateGroups) {
      const matches = group.candidates
        .filter((candidate) => candidate.normalizedText === targetText)
        .map((candidate) => ({
          candidate,
          startTime: candidate.startTime + group.offset,
          endTime: candidate.endTime + group.offset,
        }))
        .filter(({ candidate, startTime }) => {
          const overlapTolerance = candidate.hasWordTiming ? 1_500 : 250
          if (previous && startTime < previous.endTime - overlapTolerance) return false
          if (next && startTime > next.startTime + 250) return false
          return true
        })
        .sort((left, right) => left.startTime - right.startTime)

      const match = matches[0]
      if (!match) continue
      const maximumEndTime = next ? next.startTime - 50 : match.startTime + 1_500
      const endTime = Math.max(match.startTime + 100, Math.min(match.endTime, maximumEndTime))
      const sourceWords = match.candidate.hasWordTiming ? match.candidate.words : target.words
      const words = sourceWords.map((word) => {
        const startTime = Math.min(endTime - 1, Math.max(match.startTime, word.startTime + group.offset))
        if (!match.candidate.hasWordTiming) {
          return { ...word, startTime: match.startTime, endTime }
        }
        return {
          ...word,
          startTime,
          endTime: Math.max(startTime + 1, Math.min(endTime, word.endTime + group.offset)),
        }
      })
      repaired[invalidIndex] = {
        ...target,
        words,
        startTime: match.startTime,
        endTime,
        // 时间来自这条候选；它的背景人声属性也一并对齐（目标行本来就没有可用时间）。
        // 只做加法：目标行已有的标志不因候选缺标记而丢失。
        isBG: target.isBG || match.candidate.isBG,
      }
      break
    }
  }

  return repaired
}

function normalizeLine(line: LyricLine): LyricLine | null {
  if (line.words.length === 0) return null

  const timedWords = line.words.filter((word) => isValidRange(word.startTime, word.endTime))
  const hasValidLineRange = isValidRange(line.startTime, line.endTime)

  // A zero-duration TTML placeholder has no position on the playback timeline.
  // Keeping it can make AMLL mistake every normal inter-line gap for the end of the song.
  if (!hasValidLineRange && timedWords.length === 0) return null

  const validWordStartTime = timedWords.length > 0 ? Math.min(...timedWords.map((word) => word.startTime)) : Infinity
  const validWordEndTime = timedWords.length > 0 ? Math.max(...timedWords.map((word) => word.endTime)) : -Infinity
  const fallbackStartTime = hasValidLineRange ? line.startTime : validWordStartTime
  const fallbackEndTime = hasValidLineRange ? line.endTime : validWordEndTime
  const words = line.words.map((word) =>
    isValidRange(word.startTime, word.endTime)
      ? { ...word }
      : { ...word, startTime: fallbackStartTime, endTime: fallbackEndTime },
  )
  const wordStartTime = Math.min(...words.map((word) => word.startTime))
  const wordEndTime = Math.max(...words.map((word) => word.endTime))
  const startTime = hasValidLineRange ? Math.min(line.startTime, wordStartTime) : wordStartTime
  const endTime = hasValidLineRange ? Math.max(line.endTime, wordEndTime) : wordEndTime

  return {
    ...line,
    words,
    startTime,
    endTime,
  }
}

/**
 * Normalizes third-party word-by-word lyrics before AMLL builds its timeline.
 *
 * Main lines and their immediately following background-vocal lines form one
 * indivisible group. Sorting groups instead of individual lines preserves the
 * adjacency AMLL uses to attach background vocals to their main line.
 */
function normalizeValidLyricLines(lines: readonly LyricLine[]): LyricLine[] {
  const groups: LyricGroup[] = []
  let canAttachBackgroundLine = false

  for (let originalIndex = 0; originalIndex < lines.length; originalIndex++) {
    const line = normalizeLine(lines[originalIndex])
    if (!line) {
      canAttachBackgroundLine = false
      continue
    }

    const previousGroup = groups.at(-1)
    if (line.isBG && previousGroup && canAttachBackgroundLine) {
      previousGroup.lines.push(line)
      previousGroup.startTime = Math.min(previousGroup.startTime, line.startTime)
      continue
    }

    groups.push({ lines: [line], originalIndex, startTime: line.startTime })
    canAttachBackgroundLine = !line.isBG
  }

  return [...groups]
    .sort((left, right) => left.startTime - right.startTime || left.originalIndex - right.originalIndex)
    .flatMap((group) => group.lines)
}

export function repairLyricTimeline(
  lines: readonly LyricLine[],
  sources: readonly LyricRepairSource[],
): LyricTimelineResult {
  const repaired = repairInvalidLines(lines, sources)
  const normalized = normalizeValidLyricLines(repaired)
  return { lines: normalized, unresolvedCount: lines.length - normalized.length }
}

export function normalizeLyricTimeline(lines: readonly LyricLine[]): LyricLine[] {
  return repairLyricTimeline(lines, []).lines
}
