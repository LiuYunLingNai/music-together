import { Howler } from 'howler'
import { getAudioTapAnalyser, getAudioTapRevision } from '@/lib/audioTap'
import {
  resetSonicAudioMonitor,
  stepSonicAudioMonitor,
  type SonicAudioFrame,
} from './SonicAudioMonitor'

/**
 * 为 Mineradio 舞台提供频谱数据。
 *
 * 数据来源（按优先级）：
 *
 * 1. **SoundTouch tap（首选）**：本项目的音频链路是
 *
 *      HTMLMediaElement → createMediaElementSource → SoundTouch（worklet）→ destination
 *
 *    它**绕过了 `Howler.masterGain`**，因此只有 `lib/timeStretch.ts` 在
 *    worklet 输出上创建的只读 `AnalyserNode`（`lib/audioTap.ts` 发布）能读到
 *    真实频谱。masterGain 上永远没有音频流过 —— 这是"依旧没有鼓点"的
 *    最终根因（详见 `lib/audioTap.ts` 顶部说明）。
 *
 * 2. **masterGain 兜底**：SoundTouch 图尚未建立（worklet 注册是异步的）
 *    且 Howler ctx 已就绪时的临时接线。`ensureAudioAnalyser` 会在每帧
 *    检查 tap 是否已发布，一旦发布立即从兜底升级到 tap。
 *
 * 两种接线都是**只读旁路**：AnalyserNode 不接回 destination，不改变音量、
 * SoundTouch 变速或漂移校正的任何行为。任何一步失败都只降级为
 * “没有实时频谱”，绝不影响播放。
 */

/**
 * 上游 Mineradio 的八频段定义（Hz），
 * 取自 `03-beat/06-sonic-audio-monitor.js:43-52` 的 `SONIC_AUDIO_BAND_EDGES`。
 *
 * 声波地形直接消费这八段；此前本项目只有六段粗粒度 RMS 再聚合回八段，
 * 是有损且错位的映射（例如把 165-420Hz 当作 lowMid、把 vocal 当作 presence）。
 */
export const SONIC_BAND_EDGES = [
  ['subBass', 32, 58],
  ['bass', 58, 118],
  ['lowMid', 118, 260],
  ['mid', 260, 720],
  ['highMid', 720, 1800],
  ['presence', 1800, 4200],
  ['brilliance', 4200, 9000],
  ['air', 9000, 16000],
] as const

export type SonicBandId = (typeof SONIC_BAND_EDGES)[number][0]

/** 八频段能量（0..1）。 */
export type SonicBands = Record<SonicBandId, number>

export interface AudioBands {
  bass: number
  mid: number
  treble: number
  beat: number
  energy: number
  /** 低频是否命中（供涟漪触发） */
  bassHit: boolean
  /**
   * 上游八频段（Hz 边界见 `SONIC_BAND_EDGES`）。
   * 声波地形用它替换此前错位的六段映射。
   */
  sonic: SonicBands
  /**
   * 供节拍相机/门控等上游公式直接消费的细频段
   * （取自引擎 frame，均有上游对应字段）。
   */
  lowDrive: number
  body: number
  vocal: number
  snap: number
  kickCore: number
  kickSub: number
}

const EMPTY_SONIC: SonicBands = {
  subBass: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  presence: 0,
  brilliance: 0,
  air: 0,
}

const EMPTY_BANDS: AudioBands = {
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  energy: 0,
  bassHit: false,
  sonic: EMPTY_SONIC,
  lowDrive: 0,
  body: 0,
  vocal: 0,
  snap: 0,
  kickCore: 0,
  kickSub: 0,
}

let analyser: AnalyserNode | null = null
/** 当前接线来源：tap（SoundTouch 输出，有真实音频）或 masterGain（兜底）。 */
let wiredKind: 'none' | 'tap' | 'masterGain' = 'none'
let frequencyData: Uint8Array<ArrayBuffer> | null = null
let failed = false
/** 最近消费的 tap 发布代次。舞台卸载时保留，用于区分 UI 重挂载和切歌。 */
let tapRevision = -1

/**
 * 「播放中但频谱持续全零」看门狗（节拍丢失加固）。
 *
 * 本项目的音频链路绕过 `Howler.masterGain`，因此兜底线上**永远没有数据**：
 * 若 SoundTouch tap 因某种原因长期未发布（worklet 注册竞态、音频图重建
 * 失败等），所有模式的节拍反馈会静默失效，直到用户重载页面 ——
 * 正是「几个模式都丢失节拍反馈，重载可以恢复」的根因链。
 *
 * ★★ 第二十五轮修正（真实事故：后台返回后节拍反馈永久丢失）★★
 *
 * 原实现判定"死 tap"后会**拆线并回落到 masterGain 兜底线**，而那条线
 * 在本项目里**永远没有音频**。于是一次误判就变成永久锁死：
 *
 *   1. 浏览器最小化 → 标签页隐藏 → 浏览器挂起音频上下文
 *   2. 回到页面 → rAF 恢复，但上下文仍是 suspended →
 *      `getByteFrequencyData` 恒返回全零（已实测确认）
 *   3. 连续 180 帧（≈3s）全零 → 看门狗判死 → 拆线 → 落到 masterGain
 *   4. `deadTap` 的复活窗 30s 过期后，`tapped !== deadTap` 恒为 false，
 *      于是**永远停在恒零的 masterGain 上** —— 节拍反馈永久消失
 *   5. 只有切歌（发布新 tap，`tapped` 变化）或重载页面才能恢复
 *
 * 现在改为**非破坏性**看门狗：
 *
 *   a. 每帧检查 `analyser.context.state`。不是 `running` 就主动 `resume()`
 *      —— 这才是"后台返回"真正的恢复动作，并把全零计数清零：上下文挂起
 *      导致的静音**不是**死 tap，不该计入判死。
 *   b. 即使真的持续全零，**只记日志、不拆线**。tap 始终是唯一能承载音频的
 *      线路；拆掉它换到恒零的兜底线只会把问题永久化。切歌时
 *      `ensureAudioAnalyser` 会因为 `tapped !== analyser` 自动升级到新 tap，
 *      本来就不需要看门狗来触发。
 *
 * 结果：任何静音（挂起、歌内数字静音、worklet 短暂停顿）都只是**暂时**的，
 * 上下文一恢复、音频一回来就立刻恢复节拍反馈，无需切歌或刷新。
 */
const WATCHDOG_SILENT_FRAMES = 180 // ≈3s @60fps
let watchdogSilentFrames = 0
/** 日志节流：同一次异常只提示一次，避免每 3s 刷屏。 */
let watchdogWarned = false

function isSpectrumSilent(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return false
  }
  return true
}

/**
 * 音频上下文挂起时的恢复尝试（非破坏性看门狗的第一半）。
 *
 * 浏览器在标签页隐藏时会挂起 AudioContext；回到页面后 rAF 立刻恢复，
 * 但上下文仍停在 `suspended`，此时 `getByteFrequencyData` 恒返回全零
 * （headless Chrome 实测确认）。这不是"死 tap"，而是"上下文睡着了" ——
 * 只要 resume 就能完全恢复。
 *
 * 返回 true 表示"当前处于挂起/未运行状态，本帧的全零不应计入判死"。
 */
function tryResumeContext(node: AnalyserNode): boolean {
  const ctx = node.context as AudioContext | undefined
  if (!ctx || typeof ctx.state !== 'string') return false
  if (ctx.state === 'running') return false
  // closed 是终态，resume 会 reject；交给 catch 静默处理
  try {
    void ctx.resume().catch(() => {
      /* 上下文已关闭或恢复被拒：下一帧继续尝试 */
    })
  } catch {
    /* resume 同步抛错（罕见）：忽略，下一帧重试 */
  }
  return true
}

/**
 * 看门狗：只观测、不拆线（见上方第二十五轮说明）。
 *
 * 关键点：**绝不再把 tap 换成 masterGain 兜底线**。兜底线在本项目里
 * 永远没有音频，换过去等于把"暂时静音"永久化。
 */
function noteSpectrumFrame(data: Uint8Array, playing: boolean): void {
  if (!playing || !isSpectrumSilent(data)) {
    watchdogSilentFrames = 0
    watchdogWarned = false
    return
  }
  // 上下文挂起导致的静音：主动 resume，且不计入判死。
  if (analyser && tryResumeContext(analyser)) {
    watchdogSilentFrames = 0
    return
  }
  watchdogSilentFrames++
  if (watchdogSilentFrames < WATCHDOG_SILENT_FRAMES) return
  watchdogSilentFrames = 0
  if (!watchdogWarned) {
    watchdogWarned = true
    // 只提示，不动作：接线保持不动。切歌时 ensureAudioAnalyser 会因为
    // `tapped !== analyser` 自动升级到新 tap；上下文恢复后本线立刻复活。
    console.warn('[audio-analyser] spectrum silent while playing; keeping analyser wired')
  }
}

/** 最近一帧的投影结果 —— 由 `stepAudioFrame` 写、`readAudioBands` 读。 */
let cached: AudioBands | null = null

/**
 * 尝试建立分析节点。返回是否可用。
 *
 * 幂等：重复调用不会重复接线。失败后不再重试，避免每次渲染都抛错。
 */
/**
 * 尝试建立分析节点。返回是否**本次**成功。
 *
 * ★ 关键：**失败不能永久锁死。**
 *
 * 真实事故（"依旧没有鼓点"的第二个根因）：此函数原先把首次失败记进
 * `failed` 并永久返回 false。而 `AudioStepDriver` 的 effect 在**舞台挂载瞬间**
 * 就调用它 —— 那一刻 Howler 的 `AudioContext` 往往还没创建
 * （Howler 的 `setupAudioContext()` 是**懒**调用：只在 `volume()` / `mute()` /
 * `new Howl()` 时才建 ctx）。
 *
 * 于是：挂载即失败 → 永久 `failed` → 分析节点永远不存在 → 无论播放多久
 * 都没有频谱 → **地形永远没有鼓点**。
 *
 * 现在改成：只有在「Web Audio 根本不可用」时才记 `failed`（那是真的没救），
 * 单纯"ctx 还没就绪"则返回 false 并允许**下次重试**。调用方
 * （`AudioStepDriver`）会在每帧重试，因此 ctx 一就绪就会自动接上。
 */
export function ensureAudioAnalyser(): boolean {
  try {
    // ★ 首选：`timeStretch` 注册的分析节点。
    //
    // 本项目音频走 HTML5 元素 → SoundTouch → destination，**绕过 masterGain**，
    // 因此只有这个节点能读到真实频谱。详见 `lib/audioTap.ts` 的说明。
    //
    // ★★ 这一段必须在 `failed` 检查**之前**（真实事故：「从原生切到 mineradio
    //    就丢节拍」）。
    //
    //    `failed` 原本是函数开头的总闸 `if (failed) return false`，于是它一旦
    //    被置位（那是**兜底路径**专用的判据：Howler 有 ctx 却没有 masterGain、
    //    或 createAnalyser 抛错），**连 tap 这条完全独立、且唯一有音频的线路
    //    也一起被挡掉** —— tap 根本不需要 ctx 或 masterGain。
    //
    //    现在把 `failed` 降级为**只门控兜底路径**；tap 每帧无条件重试。
    //    这样任何兜底侧的瞬时失败都不会再拖累真实音频链。
    const tapped = getAudioTapAnalyser()
    const nextTapRevision = getAudioTapRevision()
    // ★ 挂起自愈：tap 可用但上下文被浏览器挂起时，先尝试恢复。
    //   否则回到页面后频谱恒零、节拍反馈要等切歌才回来。
    if (tapped) tryResumeContext(tapped)
    if (tapped) {
      if (nextTapRevision !== tapRevision) {
        // 新播放会话必须丢弃上一首歌的自适应阈值；否则高能歌曲切到安静
        // 歌曲时，旧 flux history 会让 onset 在约 90 个分析帧内持续偏钝。
        // 视觉舞台自身的卸载/重挂载不会改变 revision，因此不会误重置。
        resetSonicAudioMonitor()
        cached = null
        tapRevision = nextTapRevision
      }
      if (analyser !== tapped) {
        // 升级到 tap：拆掉兜底接线（若有），但**不** disconnect tap 本身 ——
        // 它由 timeStretch 拥有，随音频图一起销毁。
        if (wiredKind === 'masterGain') {
          try {
            ;(Howler.masterGain as GainNode | undefined)?.disconnect?.(analyser!)
          } catch {
            /* 兜底节点本就不在 masterGain 上 */
          }
        }
        analyser = tapped
        frequencyData = new Uint8Array(new ArrayBuffer(tapped.frequencyBinCount))
        wiredKind = 'tap'
      }
      // tap 是健康的：兜底侧的失败判据没有意义，顺手清掉闩锁
      failed = false
      return true
    }

    // tap 已撤回 / 尚未发布：回到未接线状态等待重试。
    //
    // ★ 这条路径在**切歌瞬间必然经过**，不是"理论上不应发生"：
    //   `disposeHowl`（hooks/useHowl.ts）先调 `releaseTimeStretch(howl)` 把全局
    //   tap 置为 null，再 `howl.unload()`；而视觉端此刻的 `wiredKind` 仍是
    //   `'tap'`（它只在读到新 tap 时才改变）。于是新歌 onload 后的第一帧就会
    //   落到这里，把接线清成 `'none'`，随后同一帧/下一帧由新发布的 tap 重新接上。
    //
    //   这条路径**故意不做任何 disconnect**：tap 节点由 `timeStretch` 拥有并
    //   随音频图销毁，这里只丢引用。任何在此处补 `analyser.disconnect()` 的
    //   改动都会静默杀掉后续曲目的分析（红线：tap 不属于本模块）。
    if (wiredKind === 'tap') {
      analyser = null
      frequencyData = null
      wiredKind = 'none'
      return false
    }
    if (wiredKind === 'masterGain') return true // 已在兜底线上；tap 发布后下帧会升级

    // ---- 以下为**兜底路径**专属，`failed` 只在这里生效 ----
    //
    // 兜底线路在本项目里**永远没有音频**（音频绕过 masterGain），它只是
    // "worklet 注册完成前不让画面全黑"的过渡。因此它的失败判据绝不能
    // 上升到函数级去挡掉 tap —— 见上方 `failed` 降级的说明。
    if (failed) return false

    // 兜底路径：Howler ctx 已就绪但 SoundTouch 图尚未建立。
    // 注意这条线上**可能**没有数据（音频链路绕过 masterGain），
    // 只是让视觉在 worklet 注册完成前不至于完全空白。
    const ctx = Howler.ctx as AudioContext | undefined
    const master = Howler.masterGain as GainNode | undefined
    // ctx/masterGain 尚未就绪：**不是**永久失败，下次再试
    if (!ctx) return false
    if (!master || typeof ctx.createAnalyser !== 'function') {
      // Web Audio 不可用（或 Howler 走了 HTML5 音频路径）。
      // ★ 只关掉兜底路径，**不**影响 tap 重试（tap 每帧仍然会走上面的分支）。
      failed = true
      return false
    }

    const node = ctx.createAnalyser()
    node.fftSize = 2048
    node.smoothingTimeConstant = 0.58
    node.minDecibels = -82
    node.maxDecibels = -8

    // 只读旁路：只从 masterGain 拉数据，不接回 destination。
    master.connect(node)

    analyser = node
    frequencyData = new Uint8Array(new ArrayBuffer(node.frequencyBinCount))
    wiredKind = 'masterGain'
    return true
  } catch (error) {
    // 构造期异常：同样可能是"上下文正在重建"，允许重试而非永久失败
    analyser = null
    frequencyData = null
    wiredKind = 'none'
    if (error instanceof Error && /AudioContext|createAnalyser/i.test(error.message)) {
      failed = true
    }
    return false
  }
}

export function isAudioAnalyserReady(): boolean {
  return wiredKind !== 'none' && analyser !== null
}

/** 把引擎 frame 投影成本项目既有的 `AudioBands` 形状。 */
function projectFrame(frame: SonicAudioFrame): AudioBands {
  return {
    bass: frame.bass,
    mid: frame.mid,
    treble: frame.treble,
    beat: frame.beat,
    energy: frame.energy,
    // 上游的 onset 就是 kickOnset，比自造的粗判准得多
    bassHit: frame.kickOnset > 0,
    sonic: {
      subBass: frame.subBass,
      bass: frame.bassBand,
      lowMid: frame.lowMid,
      mid: frame.mid,
      highMid: frame.highMid,
      presence: frame.presence,
      brilliance: frame.brilliance,
      air: frame.air,
    },
    lowDrive: frame.lowDrive,
    body: frame.body,
    vocal: frame.vocal,
    snap: frame.snap,
    kickCore: frame.kickCore,
    kickSub: frame.kickSub,
  }
}

/**
 * 推进一帧音频分析 —— **单点驱动**。
 *
 * ★ 只能由舞台根（`ParticleScene`）每帧调用**一次**。
 *
 * 为什么必须单点：`SonicAudioMonitor` 与原实现都是**有状态**的（峰值跟随、
 * 节拍历史、kick 包络）。此前 6 个组件各自调用，导致每帧推进 6 次 ——
 * 衰减快 6 倍、`lastBeatAt` 被反复覆写、谁先渲染谁"吃掉"节拍。
 * 这是「鼓点反馈弱」最直接的结构性原因。
 *
 * 其余消费者改用 `readAudioBands()`（零参数，读缓存）。
 */
export function stepAudioFrame(deltaSeconds: number, currentTime = 0, playing = true): void {
  const node = analyser
  const data = frequencyData
  // 未接线时保持上一次（或空）结果，不清零 —— 避免闪断
  if (wiredKind === 'none' || !node || !data) return

  try {
    const ctx = Howler.ctx as AudioContext | undefined
    const sampleRate = ctx?.sampleRate ?? 44100
    const fftSize = node.fftSize

    node.getByteFrequencyData(data)
    // 看门狗：播放中频谱持续全零 → 拆线重试（详见上方说明）
    noteSpectrumFrame(data, playing)

    const frame = stepSonicAudioMonitor(data, {
      dt: deltaSeconds,
      sampleRate,
      fftSize,
      currentTime,
      playing,
    })
    if (frame) cached = projectFrame(frame)
  } catch {
    // 读取失败（例如上下文已关闭）时彻底断开，避免持续抛错。
    wiredKind = 'none'
    analyser = null
    frequencyData = null
  }
}

/**
 * 读取最近一帧的频段能量（**零参数，读缓存**）。
 *
 * 消费者不得再自行触发分析 —— 那会重现"多点驱动"的状态破坏。
 */
export function readAudioBands(): AudioBands {
  return cached ?? EMPTY_BANDS
}

/** 释放分析节点。舞台卸载时调用。 */
export function disposeAudioAnalyser(): void {
  // ★ 这里**不能**写 `if (!analyser) return` 提前返回。
  //
  //   真实事故（"从原生切到 mineradio 就丢节拍 / 后台放久回来丢节拍"）：
  //   `analyser` 为 null 是**常见状态** —— 舞台挂载瞬间、tap 尚未发布、
  //   切歌过渡期、上一次 dispose 之后，都会是 null。此时提前返回会让下面
  //   的**模块状态清理全部跳过**，其中最要命的是 `failed = false`：
  //   `failed` 是兜底路径的**不可恢复闩锁**（`ensureAudioAnalyser` 里
  //   `if (failed) return false`）。一旦它在运行时被置位（Howler 懒建 ctx
  //   的过渡态、上下文重建抛错），此后兜底接线再也不会被尝试 ——
  //   且若它曾经升级成函数级总闸，连 tap 路径都会被一起挡掉（只能刷新）。
  //
  //   改为：无论 analyser 是否存在，都清理本组件拥有的接线状态与 failed
  //   闩锁；只有真正的 disconnect 才需要节点存在。节拍自适应状态由音频
  //   tap 的发布代次管理，不能在单纯切换 UI 舞台时清空。
  //
  // ★ 只有**本模块自建**的 masterGain 兜底节点才能 disconnect：
  //   tap 由 `timeStretch` 拥有并随音频图一起销毁，这里绝不碰它 ——
  //   否则重新进入舞台时会接到一个已被拆掉连接的死节点（频谱永久静默）。
  if (analyser && wiredKind === 'masterGain') {
    try {
      Howler.masterGain?.disconnect?.(analyser)
      analyser.disconnect()
    } catch {
      /* 忽略已断开的节点 */
    }
  }
  analyser = null
  frequencyData = null
  wiredKind = 'none'
  // 闩锁必须在每次卸载时清掉，否则一次瞬时失败会永久锁死分析（见上）
  failed = false
  // 保留最近的投影帧与 SonicAudioMonitor 自适应状态。视觉舞台切回经典时
  // 音频源仍在播放，清空它们会让再次进入视觉舞台重新经历 90 帧阈值学习，
  // 表现为节拍忽强忽弱。真实切歌由 tap revision 精确触发重置。
  watchdogSilentFrames = 0
  watchdogWarned = false
}
