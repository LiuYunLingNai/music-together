import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：分析节点必须挂在**真正有音频流过**的那条链路上。
 *
 * 真实事故（"依旧没有鼓点"的最终根因）：
 *   本项目音频链路是
 *     HTMLMediaElement → createMediaElementSource → SoundTouch → destination
 *   它**绕过了 Howler.masterGain**。把 AnalyserNode 接在 masterGain 上
 *   永远读不到数据 → 频谱恒为 0 → 视觉完全没有鼓点。
 *
 * 这个测试静态检查：`timeStretch.ts` 必须在 SoundTouch 图上创建并注册
 * 分析节点，且 `AudioAnalyser` 必须优先使用它。
 */
const CLIENT_SRC = join(__dirname, '..', '..', '..', '..')
const LIB = join(CLIENT_SRC, 'lib')

function read(rel: string): string {
  return readFileSync(join(LIB, rel), 'utf8')
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('音频分析接线契约', () => {
  it('timeStretch 在音频图上创建 AnalyserNode 并注册到 audioTap', () => {
    const src = stripComments(read('timeStretch.ts'))
    expect(src).toMatch(/createAnalyser\s*\(/)
    expect(src).toMatch(/publishStretchAnalyser\s*\(/)
  })

  it('元素池复用路径必须重新发布 tap（releaseTimeStretch 撤回后的闭环另一半）', () => {
    const src = stripComments(read('timeStretch.ts'))
    // attachTimeStretch 的 existing（graphByAudio 缓存命中）分支里必须重新
    // publish —— 缺了它，Howler LIFO 复用同一元素时 tap 单例恒为 null，
    // "从第二首起节拍永久丢失"（第二十轮修复的回归再引入）。
    // 结构断言：attachTimeStretch 的 existing（graphByAudio 缓存命中）分支里
    // 必须在 `return createController(existing)` 之前重新 publish —— 缺了它，
    // Howler LIFO 复用同一元素时 tap 单例恒为 null，"从第二首起节拍永久
    // 丢失"（第二十轮修复的回归再引入）。
    const anchorIdx = src.indexOf('return createController(existing)')
    expect(anchorIdx).toBeGreaterThan(-1)
    // 取 anchor 之前 600 字符的窗口：重发布必须落在紧邻 return 之前
    const beforeAnchor = src.slice(Math.max(0, anchorIdx - 600), anchorIdx)
    expect(beforeAnchor).toMatch(/publishStretchAnalyser\s*\(\s*existing\.analyser\s*\)/)
    // failed 只代表变速回退；直通 source 上的 analyser 仍可用，不能阻止发布。
    expect(beforeAnchor).not.toMatch(/!existing\.failed/)
  })

  it('快速切歌会取消尚未完成的异步建图，旧任务不得发布死 tap', () => {
    const src = stripComments(read('timeStretch.ts'))
    const awaitIdx = src.indexOf('await registerProcessor(context)')
    const createIdx = src.indexOf('context.createMediaElementSource(audio)', awaitIdx)
    const cancelledIdx = src.indexOf('pendingGraph.cancelled', awaitIdx)
    expect(awaitIdx).toBeGreaterThan(-1)
    expect(cancelledIdx).toBeGreaterThan(awaitIdx)
    expect(cancelledIdx).toBeLessThan(createIdx)

    const howlSrc = stripComments(readFileSync(join(CLIENT_SRC, 'hooks', 'useHowl.ts'), 'utf8'))
    const unloadIdx = howlSrc.indexOf('howl.unload()')
    const finalizeIdx = howlSrc.indexOf('finalizeTimeStretchRelease?.()', unloadIdx)
    expect(unloadIdx).toBeGreaterThan(-1)
    expect(finalizeIdx).toBeGreaterThan(unloadIdx)
  })

  it('变速图失败时回退直通音频，但仍建立并发布 analyser', () => {
    const src = stripComments(read('timeStretch.ts'))
    const catchIdx = src.indexOf('} catch (error) {')
    const fallback = src.slice(catchIdx, src.indexOf('return null', catchIdx))
    // ★ 音量在图内（volumeGain）：fallback 的 source 接 gain 而不是直接
    //   destination —— 静音丢节拍的修复要求两条路径（成功/失败）同语义。
    expect(fallback).toMatch(/fallbackGain\s*=\s*context\.createGain\(\)/)
    expect(fallback).toMatch(/source\.connect\(fallbackGain\)/)
    // 直通路径同样过 ReplayGain 增益（成功路径也有这个节点）。
    expect(fallback).toMatch(/fallbackGain\.connect\(fallbackReplayGain\)/)
    expect(fallback).toMatch(/fallbackReplayGain\.connect\(context\.destination\)/)
    expect(fallback).toMatch(/fallbackAnalyser\s*=\s*context\.createAnalyser\(\)/)
    expect(fallback).toMatch(/source\.connect\(fallbackAnalyser\)/)
    expect(fallback).toMatch(/publishStretchAnalyser\(fallbackAnalyser\)/)
  })

  it('用户音量 √v 拆分 + 静音地板（上游 Mineradio writeAudioOutputGain 同款）', () => {
    const src = stripComments(read('timeStretch.ts'))
    // 1. 成功图：soundtouch → EQ → volumeGain → destination，分析线在 gain 之前
    //    （analyser 卡在元素 √v 与图内 √v 之间 —— 上游拓扑；EQ 在 analyser 上游）
    expect(src).toMatch(/connectEqualizer\(\s*stretchNode/)
    expect(src).toMatch(/volumeGain\.connect\(context\.destination\)/)
    // 2. 音量分支走感知平方根 + 地板（跟随音量 + 静音不丢节拍）
    expect(src).toMatch(/function splitVolumeGain/)
    expect(src).toMatch(/Math\.sqrt\(volume\)/)
    expect(src).toMatch(/AUDIO_SILENCE_GAIN = 0\.005/)
    // 3. 元素 volume 属性被转发（Howler 的 howl.volume/fade 无需改）
    expect(src).toMatch(/installVolumeRouting\(/)
    expect(src).toMatch(/defineProperty\(audio,\s*'volume'/)
    // 4. release 时还原原生属性；复用分支重新安装
    expect(src).toMatch(/uninstallVolumeRouting\(/)
    const reuseIdx = src.indexOf('return createController(existing)')
    const beforeReuse = src.slice(Math.max(0, reuseIdx - 600), reuseIdx)
    expect(beforeReuse).toMatch(/installVolumeRouting\(/)
    // 5. 看门狗可查询静音地板（放行"播放中静音"的预期全零）
    expect(src).toMatch(/export function isPlaybackVolumeAtFloor/)
  })

  it('分析节点挂在效果链出口，旁路切换不摘掉它', () => {
    const src = stripComments(read('timeStretch.ts'))
    // 链路：source → soundtouch → EQ → chainInput → 效果链 → chainOutput → analyser
    expect(src).toMatch(/createAudioEffectChain\s*\(/)
    expect(src).toMatch(/chainOutput\.connect\(analyser\)/)
    // 旁路/恢复只改均衡器接法，效果链出口必须保持连接
    expect(src).not.toMatch(/chainOutput\.disconnect/)
    const matches = src.match(/graph\.chainInput/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('AudioAnalyser 优先使用 audioTap 的节点，而不是 masterGain', () => {
    const src = stripComments(
      readFileSync(join(CLIENT_SRC, 'components', 'Player', 'stages', 'AudioAnalyser.ts'), 'utf8'),
    )
    expect(src).toMatch(/getAudioTapAnalyser\s*\(/)
    // getAudioTapAnalyser 必须在 masterGain 之前被检查（优先使用）
    const tapIdx = src.indexOf('getAudioTapAnalyser')
    const masterIdx = src.indexOf('Howler.masterGain')
    expect(tapIdx).toBeGreaterThan(-1)
    expect(masterIdx).toBeGreaterThan(-1)
    expect(tapIdx).toBeLessThan(masterIdx)
  })

  it('audioTap 为复用同一节点的新播放会话提供发布代次', () => {
    const src = stripComments(read('audioTap.ts'))
    expect(src).toMatch(/revision\+\+/)
    expect(src).toMatch(/export function getAudioTapRevision\s*\(\s*\)/)
  })
})
