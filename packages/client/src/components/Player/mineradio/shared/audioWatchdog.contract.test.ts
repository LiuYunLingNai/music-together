import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：音频看门狗**只许观测，绝不许拆线**。
 *
 * ============================ 真实事故 ============================
 *
 * 第二十五轮用户反馈：「浏览器最小化放后台再回到页面就丢失节拍反馈，
 * 要切歌或重载才可能恢复。」
 *
 * 根因：看门狗判定「死 tap」后会**拆线并回落到 `masterGain` 兜底线**，
 * 而那条线在本项目里**永远没有音频**（音频链路是
 * `HTMLMediaElement → createMediaElementSource → SoundTouch → destination`，
 * 绕过 masterGain）。于是：
 *
 *   1. 标签页隐藏 → 浏览器挂起 AudioContext
 *   2. 回到页面 → rAF 恢复，但上下文仍 `suspended` →
 *      `getByteFrequencyData` 恒返回全零（headless Chrome 实测确认）
 *   3. 连续 180 帧全零 → 看门狗判死 → 落到恒零的兜底线
 *   4. `deadTap` 复活窗过期后 `tapped !== deadTap` 恒为 false →
 *      **永久停在静默线上**，直到切歌（发布新 tap）或重载
 *
 * 这个测试不跑运行时，只做静态检查：读源码，断言「拆线」这个动作
 * 不再出现在看门狗路径里，且上下文挂起自愈存在。
 */
const AUDIO_ANALYSER = readFileSync(join(__dirname, 'AudioAnalyser.ts'), 'utf8')

/** 去掉注释，避免把说明文字里的代码也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('音频看门狗：非破坏性契约', () => {
  const body = stripComments(AUDIO_ANALYSER)

  it('看门狗不得断开分析节点（拆线会把暂时静音永久化）', () => {
    // 事故代码形如：在 noteSpectrumFrame 里 disconnect 当前 analyser
    // 并置 wiredKind = 'none'。这两个动作都不允许出现在看门狗函数里。
    const fn = body.match(/function noteSpectrumFrame\([\s\S]*?\n\}/)
    expect(fn, 'noteSpectrumFrame 未找到').toBeTruthy()
    const source = fn![0]
    expect(source).not.toMatch(/disconnect/)
    expect(source).not.toMatch(/wiredKind\s*=/)
    expect(source).not.toMatch(/analyser\s*=\s*null/)
  })

  it('判死/复活窗机制已整体删除（它只服务于"拆线重连"这条错误路径）', () => {
    expect(body).not.toMatch(/deadTap/)
    expect(body).not.toMatch(/DEAD_TAP_REVIVE_WINDOW_MS/)
    expect(body).not.toMatch(/probeBuffer/)
  })

  it('上下文挂起时主动 resume（这才是"后台返回"真正需要的动作）', () => {
    expect(body).toMatch(/function tryResumeContext/)
    expect(body).toMatch(/ctx\.resume\(\)/)
    // 挂起帧必须排除在判死之外，否则仍会被误判
    const fn = body.match(/function noteSpectrumFrame\([\s\S]*?\n\}/)
    expect(fn![0]).toMatch(/tryResumeContext/)
  })

  it('tap 接线路径也做挂起自愈（回到页面即刻恢复，不等切歌）', () => {
    const fn = body.match(/export function ensureAudioAnalyser\([\s\S]*?\n\}/)
    expect(fn, 'ensureAudioAnalyser 未找到').toBeTruthy()
    expect(fn![0]).toMatch(/tryResumeContext/)
  })

  it('看门狗只提示一次（日志节流，避免每 3s 刷屏）', () => {
    expect(body).toMatch(/watchdogWarned/)
  })
})
