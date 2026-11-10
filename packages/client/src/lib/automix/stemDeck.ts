import { Howler } from 'howler'
import type { Track } from '@music-together/shared'
import { STEM_SAMPLE_RATE, separateStereoWindow, type StemStereo, type StemWindowSet } from '@/services/analysis/stems'
import {
  envelopeOf,
  incomingCurves,
  OTHER_SWEEP_END,
  OTHER_SWEEP_HZ,
  outgoingCurves,
  planStemHandover,
  singsInWindow,
  type StemHandover,
} from './upstream/stemGesture'
import {
  expansionMask,
  planExpansion,
  renderExpansion,
  type ExpansionPlan,
  type ExpansionStem,
} from './upstream/expansionGesture'
import { runExclusive } from './analysisQueue'
import { usePlayerStore } from '@/stores/playerStore'
import { fetchAudioBytes, commitAudioBytesToCache } from '@/lib/audioBytes'
import { wholeSongVerdict } from '@/lib/wholeSongCheck'
import { trackCacheKey } from '@/lib/playbackSource'

/**
 * 自动混音的 stem deck（单人房专用）。
 *
 * 过渡窗口内用四轨重建两首歌，并按上游 `stemGesture` 的次序交接：
 * 鼓先换手（窗口 42% 处），一个小节后换贝斯，再一个小节后人声进入；
 * 出歌人声在 `vocalIn` 前退出。窗口结束后把音频交还给媒体元素。
 *
 * 任何一步失败（CORS、模型不可用、解码失败、来不及准备）都返回 null，
 * 调用方回退到普通交叉淡化。
 */

export const STEM_TRANSITION_PREP_LEAD_SEC = 45
/** 实测准备耗时的两倍，慢机自动提前；上限 3 分钟。 */
let lastPrepareSec = 0
export const stemPrepLeadSec = (): number =>
  Math.min(180, Math.max(STEM_TRANSITION_PREP_LEAD_SEC, Math.ceil(lastPrepareSec * 2)))
/** 分轨总线与媒体元素交接的交叉长度，与上游 `SPLICE_SEC` 一致。 */
const STEM_HANDOFF_SEC = 0.008

interface StemBuffers {
  drums: AudioBuffer
  bass: AudioBuffer
  other: AudioBuffer
  vocals: AudioBuffer
}

export interface StemTransitionPlan {
  fromId: string
  toId: string
  overlapSec: number
  /** 出歌窗口在曲目内的起点（服务端 outStart）。 */
  outgoingStartSec: number
  /** 新曲进入的媒体时间（服务端 inStart）。 */
  incomingStartSec: number
  /** 上游 `planStemHandover` 的换手点与人声退出。 */
  handover: StemHandover
  /** performance 模式的 build-up；null 表示不执行。 */
  expansion: ExpansionPlan | null
  expansionBuffers: Partial<Record<ExpansionStem, AudioBuffer>>
  outgoing: StemBuffers
  incoming: StemBuffers
}

const plans = new Map<string, StemTransitionPlan>()
const pending = new Map<string, Promise<StemTransitionPlan | null>>()
/** 每次清空换一代，正在解码的旧任务回来后不再写回。 */
let generation = 0

/**
 * 上游 `MAX_WINDOWS` 的宿主体量：一个 plan 含两侧窗口，所以 4 个窗口 = 2 对。
 * 只留“正在等的一对 + 刚用过的一对”，重复播放/重试的过渡不必再分一次。
 */
const MAX_PLANS = 2
/** 当前这次过渡关心的曲目对（`from->to@`）。 */
const wantedPairs = new Set<string>()

export const setWantedStems = (pairs: readonly string[]): void => {
  wantedPairs.clear()
  for (const pair of pairs) wantedPairs.add(pair)
}

/** 关闭分轨 / 离开房间时释放已解码的两侧窗口。 */
export function clearStemPlans(): void {
  generation += 1
  plans.clear()
  pending.clear()
  wantedPairs.clear()
}

/** 上游 `pickStemVictim`：先淘汰不在等待中的，再按最早进入淘汰。 */
const pickStemVictim = (): string | null => {
  let wantedKey: string | null = null
  for (const key of plans.keys()) {
    const isWanted = [...wantedPairs].some((pair) => key.startsWith(pair))
    if (!isWanted) return key
    wantedKey ??= key
  }
  return wantedKey
}

const keyOf = (fromId: string, toId: string, overlapSec: number, inStartSec = 0): string =>
  `${fromId}->${toId}@${overlapSec.toFixed(2)}+${inStartSec.toFixed(2)}`

const decodeCtx = (): OfflineAudioContext | null => {
  if (typeof window === 'undefined') return null
  const Ctx = window.OfflineAudioContext
  return Ctx ? new Ctx(2, 1, STEM_SAMPLE_RATE) : null
}

async function loadWindow(
  url: string,
  cacheKey: string,
  statedDurationSec: number | undefined,
  startSec: number,
  lengthSec: number,
): Promise<StemStereo | null> {
  try {
    const bytes = await fetchAudioBytes(cacheKey, url, {
      persist: true,
      statedDurationSec: statedDurationSec ?? null,
    })
    if (!bytes) return null
    const ctx = decodeCtx()
    if (!ctx) return null
    const decoded = await ctx.decodeAudioData(bytes)
    commitAudioBytesToCache(cacheKey, decoded.duration, statedDurationSec ?? null)
    if (wholeSongVerdict(decoded.duration, statedDurationSec) === 'not-the-song') return null
    const start = Math.max(0, Math.floor(startSec * STEM_SAMPLE_RATE))
    const length = Math.min(decoded.length - start, Math.ceil(lengthSec * STEM_SAMPLE_RATE))
    if (length <= 0) return null
    const left = decoded.getChannelData(0).slice(start, start + length)
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1).slice(start, start + length) : left.slice()
    return { left, right }
  } catch {
    return null
  }
}

const toBuffer = (context: AudioContext, stem: StemStereo): AudioBuffer => {
  const buffer = context.createBuffer(2, stem.left.length, STEM_SAMPLE_RATE)
  buffer.copyToChannel(stem.left as Float32Array<ArrayBuffer>, 0)
  buffer.copyToChannel(stem.right as Float32Array<ArrayBuffer>, 1)
  return buffer
}

function toBuffers(context: AudioContext, stems: StemWindowSet): StemBuffers {
  return {
    drums: toBuffer(context, stems.drums),
    bass: toBuffer(context, stems.bass),
    other: toBuffer(context, stems.other),
    vocals: toBuffer(context, stems.vocals),
  }
}

export interface StemGestureContext {
  outgoingBarSec: number | null
  incomingBarSec: number | null
  outgoingDownbeatOffset: number | null
  keysClash: boolean
  incomingSectionStart: number | null
}

const mixEnvelopeOf = (stems: StemWindowSet, sampleRate: number): Float32Array => {
  const length = stems.vocals.left.length
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (const stem of [stems.drums, stems.bass, stems.other, stems.vocals]) {
    for (let index = 0; index < length; index += 1) {
      left[index]! += stem.left[index]!
      right[index]! += stem.right[index]!
    }
  }
  return envelopeOf([left, right], sampleRate)
}

/** 出歌窗口内的小节线（相对窗口起点），与上游 `automixSession` 的 bars 同义。 */
const barsInWindow = (
  outgoingStartSec: number,
  windowSec: number,
  barSec: number | null,
  downbeatOffset: number | null,
): number[] => {
  if (!barSec || !(barSec > 0) || downbeatOffset === null) return []
  const bars: number[] = []
  const first = downbeatOffset + Math.ceil((outgoingStartSec - downbeatOffset) / barSec) * barSec
  for (let at = first; at <= outgoingStartSec + windowSec; at += barSec) {
    const local = at - outgoingStartSec
    if (local >= 0) bars.push(local)
  }
  return bars
}

async function prepare(
  outgoingUrl: string,
  outgoingKey: string,
  outgoingStartSec: number,
  incomingUrl: string,
  incomingKey: string,
  outgoingDuration: number | undefined,
  incomingDuration: number | undefined,
  incomingStartSec: number,
  overlapSec: number,
  gesture: StemGestureContext,
  expansionIntensity: number | null = null,
  beatsPerBar = 4,
  isCurrent: () => boolean = () => true,
): Promise<{
  outgoing: StemBuffers
  incoming: StemBuffers
  handover: StemHandover
  expansion: ExpansionPlan | null
  expansionBuffers: Partial<Record<ExpansionStem, AudioBuffer>>
} | null> {
  const context = Howler.ctx
  if (!context) return null
  const windowSec = overlapSec + 0.5
  // 串行解码：两首整曲同时解会在一瞬间占掉数百 MB，低配机器直接卡死。
  const outgoingWindow = await loadWindow(
    outgoingUrl,
    outgoingKey,
    outgoingDuration,
    outgoingStartSec,
    windowSec,
  )
  if (!outgoingWindow) return null
  if (!isCurrent()) return null
  const incomingWindow = await loadWindow(
    incomingUrl,
    incomingKey,
    incomingDuration,
    incomingStartSec,
    windowSec,
  )
  if (!incomingWindow) return null
  if (!isCurrent()) return null
  const outgoingStems = await separateStereoWindow(outgoingWindow.left, outgoingWindow.right, isCurrent)
  if (!outgoingStems) return null
  const incomingStems = await separateStereoWindow(incomingWindow.left, incomingWindow.right, isCurrent)
  if (!incomingStems) return null
  if (!isCurrent()) return null

  const outgoingVocals = envelopeOf(
    [outgoingStems.vocals.left, outgoingStems.vocals.right],
    STEM_SAMPLE_RATE,
  )
  const outgoingMix = mixEnvelopeOf(outgoingStems, STEM_SAMPLE_RATE)
  const incomingVocals = envelopeOf(
    [incomingStems.vocals.left, incomingStems.vocals.right],
    STEM_SAMPLE_RATE,
  )
  const incomingMix = mixEnvelopeOf(incomingStems, STEM_SAMPLE_RATE)
  const handover = planStemHandover(
    overlapSec,
    gesture.outgoingBarSec,
    gesture.incomingBarSec,
    barsInWindow(outgoingStartSec, overlapSec, gesture.outgoingBarSec, gesture.outgoingDownbeatOffset),
    outgoingVocals,
    outgoingMix,
    {
      keysClash: gesture.keysClash,
      // 上游要求「分轨负判 + 结构边界」两条证据同时成立；这里用入歌分轨做第一半。
      sings: singsInWindow(incomingVocals, incomingMix),
    },
  )
  const expansion =
    expansionIntensity === null
      ? null
      : planExpansion(
          expansionIntensity,
          handover.swap,
          gesture.outgoingBarSec,
          overlapSec,
          beatsPerBar,
        )
  const expansionBuffers: Partial<Record<ExpansionStem, AudioBuffer>> = {}
  if (expansion) {
    for (const name of expansion.stems) {
      const rendered = renderExpansion(
        [outgoingStems[name].left, outgoingStems[name].right],
        expansion,
        STEM_SAMPLE_RATE,
      )
      expansionBuffers[name] = toBuffer(context, { left: rendered[0]!, right: rendered[1]! })
    }
  }
  return {
    outgoing: toBuffers(context, outgoingStems),
    incoming: toBuffers(context, incomingStems),
    handover,
    expansion,
    expansionBuffers,
  }
}

/**
 * 提前准备一次过渡。`outgoingStartSec` 是出歌窗口在曲目内的起点
 * （通常是 `duration - overlap`）。重复调用共用同一个 Promise。
 */
export function prepareStemTransition(options: {
  outgoing: Track
  outgoingUrl: string
  outgoingStartSec: number
  incoming: Track
  incomingUrl: string
  incomingStartSec?: number
  overlapSec: number
  gesture: StemGestureContext
  /** performance 模式的 build-up 强度；缺省或 null 表示普通交接。 */
  expansion?: number | null
  beatsPerBar?: number
}): Promise<StemTransitionPlan | null> {
  const incomingStartSec = Math.max(0, options.incomingStartSec ?? 0)
  const expansion = options.expansion ?? null
  const taskGeneration = generation
  setWantedStems([`${options.outgoing.id}->${options.incoming.id}@`])
  const key = `${keyOf(options.outgoing.id, options.incoming.id, options.overlapSec, incomingStartSec)}+e${(expansion ?? 0).toFixed(2)}`
  const existing = plans.get(key)
  if (existing) return Promise.resolve(existing)
  const running = pending.get(key)
  if (running) return running

  // 与画像预取共用一条队列：两份整曲解码同时进行会顶爆内存。
  const task = runExclusive(async () => {
    const started = performance.now()
    try {
      return await prepare(
        options.outgoingUrl,
        trackCacheKey(options.outgoing),
        options.outgoingStartSec,
        options.incomingUrl,
        trackCacheKey(options.incoming),
        options.outgoing.duration,
        options.incoming.duration,
        incomingStartSec,
        options.overlapSec,
        options.gesture,
        expansion,
        options.beatsPerBar ?? 4,
        () => taskGeneration === generation,
      )
    } finally {
      lastPrepareSec = (performance.now() - started) / 1000
    }
  }).catch(() => null).then((stem) => {
    if (!stem || taskGeneration !== generation) return null
    const plan: StemTransitionPlan = {
      fromId: options.outgoing.id,
      toId: options.incoming.id,
      overlapSec: options.overlapSec,
      outgoingStartSec: Math.max(0, options.outgoingStartSec),
      incomingStartSec,
      ...stem,
    }
    plans.set(key, plan)
    // 上游的窗口池：保留正在等待的一对与刚用过的一对，其余先淘汰。
    while (plans.size > MAX_PLANS) {
      const victim = pickStemVictim()
      if (victim === null) break
      plans.delete(victim)
    }
    return plan
  }).finally(() => {
    pending.delete(key)
  })
  pending.set(key, task)
  return task
}

export function takeStemTransition(
  fromId: string,
  toId: string,
  overlapSec: number,
  inStartSec?: number,
): StemTransitionPlan | null {
  const prefix =
    inStartSec !== undefined
      ? `${keyOf(fromId, toId, overlapSec, inStartSec)}+`
      : `${fromId}->${toId}@${overlapSec.toFixed(2)}+`
  for (const [key, plan] of plans) {
    if (!key.startsWith(prefix)) continue
    // 上游 `getStemsByKey` 用完仍留在池里：上一首/重播同一次过渡不必重新分离。
    return plan
  }
  return null
}

/** 上游 `crossfadeGraph.softLimit`：0.95 膝点，±4 的可视范围。 */
const LIMIT_KNEE = 0.95
const LIMIT_RANGE = 4

const softLimit = (x: number): number => {
  const level = Math.abs(x)
  if (level <= LIMIT_KNEE) return x
  const room = 1 - LIMIT_KNEE
  const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room)
  return x < 0 ? -held : held
}

const createStemBus = (
  context: AudioContext,
  volumeScale: number,
  destination: AudioNode,
): { input: GainNode; output: GainNode } => {
  const points = 8192
  const curve = new Float32Array(points)
  for (let index = 0; index < points; index += 1) {
    curve[index] = softLimit(((index / (points - 1)) * 2 - 1) * LIMIT_RANGE)
  }
  const input = context.createGain()
  input.gain.value = 1 / LIMIT_RANGE
  const shaper = context.createWaveShaper()
  shaper.curve = curve
  shaper.oversample = 'none'
  const output = context.createGain()
  output.gain.value = volumeScale
  input.connect(shaper).connect(output).connect(destination)
  return { input, output }
}

interface DeckSource {
  source: AudioBufferSourceNode
  gain: GainNode
  filter?: BiquadFilterNode
}

/** 曲线从 `elapsedSec` 处开始播放，保持与媒体元素同一时间线。 */
const scheduleCurve = (param: AudioParam, curve: Float32Array, startAt: number, duration: number, elapsedSec: number): void => {
  if (elapsedSec >= duration) {
    param.setValueAtTime(curve[curve.length - 1]!, startAt)
    return
  }
  const progress = Math.max(0, Math.min(1, elapsedSec / duration))
  const firstIndex = Math.min(curve.length - 2, Math.floor(progress * (curve.length - 1)))
  const slice = curve.slice(firstIndex)
  const remaining = Math.max(0.001, duration - (firstIndex / (curve.length - 1)) * duration)
  param.setValueCurveAtTime(slice, startAt, remaining)
}

/**
 * 从 `startAt`（AudioContext 时间）开始播放过渡窗口，返回停止函数。
 * `outElapsedSec` / `inElapsedSec` 是两侧元素在窗口内已经走过的时长，
 * 分别取自各自媒体元素的 `currentTime`，避免服务端时钟与元素实际落点
 * 的偏差让 stem 与媒体元素错位。
 */
export function startStemTransition(
  plan: StemTransitionPlan,
  startAt: number,
  outElapsedSec = 0,
  inElapsedSec = outElapsedSec,
  /** 出歌/入歌 deck 的分轨接入点；缺省时退回 Howler 总线。 */
  outDestination?: AudioNode | null,
  inDestination?: AudioNode | null,
): () => void {
  const context = Howler.ctx
  if (!context) return () => {}
  const volume = Math.max(0, Math.min(1, usePlayerStore.getState().volume))
  // deck 链里的音量节点只承担 √v；元素自身也承担另一半。分轨接入链内后
  // 只需补上同样的 √v，最终响度与元素路径一致。直接接 masterGain 时仍用线性音量。
  const routed = Boolean(outDestination && inDestination)
  const scale = routed ? Math.sqrt(volume) : volume
  const fallback = Howler.masterGain ?? context.destination
  const outBus = createStemBus(context, scale, outDestination ?? fallback)
  const inBus = createStemBus(context, scale, inDestination ?? fallback)

  const sources: DeckSource[] = []
  const add = (
    buffers: StemBuffers,
    incoming: boolean,
    elapsedSec: number,
    busInput: GainNode,
  ): Record<string, GainNode> => {
    const gains: Record<string, GainNode> = {}
    for (const name of ['drums', 'bass', 'other', 'vocals'] as const) {
      const source = context.createBufferSource()
      source.buffer = buffers[name]
      const gain = context.createGain()
      gain.gain.value = incoming ? 0 : 1
      source.connect(gain)
      let filter: BiquadFilterNode | undefined
      if (!incoming && name === 'other') {
        // 出歌的 pad/吉他床从下方被削掉，留下的是空气而不是躯干。
        filter = context.createBiquadFilter()
        filter.type = 'highpass'
        filter.frequency.setValueAtTime(OTHER_SWEEP_HZ[0], startAt)
        filter.frequency.exponentialRampToValueAtTime(
          OTHER_SWEEP_HZ[1],
          startAt + plan.overlapSec * OTHER_SWEEP_END,
        )
        gain.connect(filter)
        filter.connect(busInput)
      } else {
        gain.connect(busInput)
      }
      source.start(
        startAt,
        Math.max(0, Math.min(elapsedSec, buffers[name].duration - 0.01)),
      )
      sources.push({ source, gain, filter })
      gains[name] = gain
    }
    return gains
  }
  const outGains = add(plan.outgoing, false, outElapsedSec, outBus.input)
  const inGains = add(plan.incoming, true, inElapsedSec, inBus.input)

  // build-up 是渲染好的独立缓冲，接在总线输入上，并在 mask 区间内把原 stem 静音。
  const expansionSources: AudioBufferSourceNode[] = []
  if (plan.expansion) {
    const build = plan.expansion
    const buildLength = build.to - build.from
    const when = startAt + Math.max(0, build.from - outElapsedSec)
    const offset = Math.max(0, outElapsedSec - build.from)
    if (outElapsedSec < build.to && offset < buildLength) {
      for (const name of build.stems) {
        const buffer = plan.expansionBuffers[name]
        if (!buffer) continue
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(outBus.input)
        source.start(when, offset)
        expansionSources.push(source)
      }
    }
  }

  const mask = plan.expansion ? expansionMask(plan.overlapSec, plan.expansion) : null
  const masked = plan.expansion ? new Set<string>(plan.expansion.stems) : null
  const outCurves = outgoingCurves(plan.overlapSec, plan.handover)
  const inCurves = incomingCurves(plan.overlapSec, plan.handover)
  for (const name of ['drums', 'bass', 'other', 'vocals'] as const) {
    let outCurve = outCurves[name]
    if (mask && masked?.has(name) && plan.expansionBuffers[name as ExpansionStem]) {
      outCurve = outCurve.slice()
      const length = Math.min(outCurve.length, mask.length)
      for (let i = 0; i < length; i += 1) outCurve[i]! *= mask[i]!
    }
    scheduleCurve(outGains[name]!.gain, outCurve, startAt, plan.overlapSec, outElapsedSec)
    scheduleCurve(inGains[name]!.gain, inCurves[name], startAt, plan.overlapSec, inElapsedSec)
  }

  return () => {
    const now = context.currentTime
    for (const bus of [outBus, inBus]) {
      const gain = bus.output.gain
      try {
        gain.cancelScheduledValues(now)
        gain.setValueAtTime(gain.value, now)
        gain.linearRampToValueAtTime(0, now + STEM_HANDOFF_SEC)
      } catch {
        // 总线已经断开。
      }
    }
    for (const { source } of sources) {
      try {
        source.stop(now + STEM_HANDOFF_SEC + 0.004)
      } catch {
        // 已经自然结束。
      }
    }
    for (const source of expansionSources) {
      try {
        source.stop(now + STEM_HANDOFF_SEC + 0.004)
      } catch {
        // 已经自然结束。
      }
    }
    window.setTimeout(() => {
      for (const { source, filter } of sources) {
        source.disconnect()
        filter?.disconnect()
      }
      for (const source of expansionSources) source.disconnect()
      outBus.input.disconnect()
      outBus.output.disconnect()
      inBus.input.disconnect()
      inBus.output.disconnect()
    }, 40)
  }
}
