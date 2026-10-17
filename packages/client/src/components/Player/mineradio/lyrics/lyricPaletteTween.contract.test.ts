import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：歌词调色板补间（上游 `setStageLyricPalette`，
 * `02-visual/07-lyrics-palette-text-utils.js:217-243`）。
 *
 * ============================ 为什么需要 ============================
 *
 * 调色板由**封面**主导。本项目此前每帧
 * `(color as THREE.Color).set(palette.primary)` —— 封面加载完成、切歌、
 * 或暗色封面触发 `BACKDROP_ADAPT` 时，歌词颜色**瞬间跳变**。
 *
 * 上游是 520ms 的 smoothstep 补间（`visualEase` + `mixStageLyricPalette`，
 * 夹 120~1200ms）。这里用源码结构断言钉住它，并**同时**钉住两条容易
 * 踩的坑：
 *
 *   ① 补间状态是**模块级单例**，每帧只能推进一次。
 *      若在每行的 `stepRow` 里各调一次，同一帧的 `elapsed` 会被推进 N 次，
 *      补间速度变成 N 倍 —— 表现为"颜色一闪就到位"。
 *   ② 不得把目标值直接 `.set()` 进 uniform。
 *      那就退回成没有补间。
 */
const SOURCE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('歌词调色板补间（上游 setStageLyricPalette）', () => {
  const body = stripComments(SOURCE)

  it('时长是上游的 520ms', () => {
    expect(body).toMatch(/LYRIC_PALETTE_TWEEN_MS\s*=\s*520/)
  })

  it('用 smoothstep（上游 visualEase）而不是线性', () => {
    // 插值系数必须由 smoothstep 算出；线性插值会让颜色匀速渐变，观感偏机械。
    // 上游同一个函数叫 `visualEase`（15-ripples-cover-depth.js:383），
    // 实现就是 `t*t*(3-2*t)`，与这里的 smoothstep 同式。
    expect(body).toMatch(/const t = smoothstep\(/)
    // 且三个通道都用这同一个系数（不得有的通道走线性）
    const lerps = (body.match(/\.lerp\(target\w+,\s*t\)/g) ?? []).length
    expect(lerps, '三个颜色通道必须共用 smoothstep 系数').toBe(3)
  })

  it('① 每帧只推进一次补间（单例状态不得被逐行重复推进）', () => {
    const calls = (body.match(/stepLyricPalette\(/g) ?? []).length
    // 只允许**一次**调用（帧首）+ 定义处的签名一次
    expect(calls, 'stepLyricPalette 被调用了多次 —— 补间速度会翻倍').toBeLessThanOrEqual(2)
    // 且那次调用必须位于行循环之前（用 currentLineGlow 作锚点：两者相邻）
    const callAt = body.indexOf('stepLyricPalette(dt')
    const loopAt = body.indexOf('for (let k = 0; k < subs.length')
    expect(callAt, '补间调用不在帧首').toBeGreaterThan(-1)
    expect(callAt).toBeLessThan(loopAt)
  })

  it('① 补间结果经参数下传给行循环（而非每行重算）', () => {
    // stepRow 的签名里必须接收补间结果
    expect(body).toMatch(/paletteTweened:\s*\{[^}]*primary:\s*THREE\.Color/)
    // 且调用处真的传了它
    expect(body).toMatch(/currentLineGlow,\s*paletteTweened,/)
  })

  it('② 四个颜色 uniform 都从补间结果拷贝，不再直接 set 目标色', () => {
    const copies = (body.match(/\.copy\(paletteTweened\.(primary|highlight|secondary)\)/g) ?? []).length
    // uBaseColor / uHiColor / uGlowColor / uSolarColor 四处
    expect(copies).toBeGreaterThanOrEqual(8)
    // 不得再出现把目标色直接灌进 uniform 的写法
    expect(body).not.toMatch(/uBaseColor\.value as THREE\.Color\)\.set\(/)
  })

  it('补间有终点判定（不会无限逼近）', () => {
    expect(body).toMatch(/elapsed\s*>=\s*LYRIC_PALETTE_TWEEN_MS/)
  })

  it('首帧直接落位（不做补间）', () => {
    // 没有"上一次"可作起点时直接 copy 目标，避免从黑色渐变到主题色
    expect(body).toMatch(/elapsed\s*<\s*0/)
  })
})
