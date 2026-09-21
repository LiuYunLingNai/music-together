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
  })

  it('分析节点在启用/旁路两条路径上都保持连接（否则切变速会丢频谱）', () => {
    const src = stripComments(read('timeStretch.ts'))
    // disableGraph 与 enableGraph 都应重新连接 analyser
    const matches = src.match(/graph\.analyser\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('AudioAnalyser 优先使用 audioTap 的节点，而不是 masterGain', () => {
    const src = stripComments(
      readFileSync(join(CLIENT_SRC, 'components', 'Player', 'mineradio', 'shared', 'AudioAnalyser.ts'), 'utf8'),
    )
    expect(src).toMatch(/getAudioTapAnalyser\s*\(/)
    // getAudioTapAnalyser 必须在 masterGain 之前被检查（优先使用）
    const tapIdx = src.indexOf('getAudioTapAnalyser')
    const masterIdx = src.indexOf('Howler.masterGain')
    expect(tapIdx).toBeGreaterThan(-1)
    expect(masterIdx).toBeGreaterThan(-1)
    expect(tapIdx).toBeLessThan(masterIdx)
  })
})
