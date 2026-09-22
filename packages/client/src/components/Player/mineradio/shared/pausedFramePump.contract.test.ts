import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAUSED_TARGET_FPS, resolveFrameloop } from './RenderPolicy'

/**
 * 回归：**暂停省钱**与**暂停不出黑屏**是同一个契约的两半，必须成对存在。
 *
 * ============================ 两次方向相反的事故 ============================
 *
 * **第一次（黑屏）**：`resolveFrameloop` 在暂停时返回 `'demand'`，但整个舞台
 *   的动态（uniform 推进、涟漪、节拍相机、星河流、歌词呼吸）都写在 `useFrame`
 *   里，而代码**从不 `invalidate()`** → 渲染循环整帧不跑 → 用户看到一块**纯黑
 *   舞台**（当时实测 clear=0 / drawArrays=0）。
 *
 * **第二次（空转）**：为修黑屏改成了"只要页面可见就 `always`"，首参写成
 *   `_isPlaying` —— 根本没用，于是**暂停时仍按 vsync 满帧渲染**，GPU/CPU 持续
 *   满载。上游明确按播放态降频（`11-main-loop.js:262-277` 非播放返回 24）。
 *
 * 现在的解法是**两半同时存在**：暂停 → `demand`（省电）+ `PausedFramePump`
 * （以 24fps 主动 `invalidate()`，照常出画）。
 *
 * ★ 本文件钉的正是这个"配对"：`RenderPolicy.test.ts` 只能钉住纯函数的返回值
 *   （它无法知道调用方有没有挂帧泵），而**只改一半就会退回其中一次事故**：
 *     · 去掉帧泵 → 退回第一次（黑屏）
 *     · 把 `demand` 改回 `always` → 退回第二次（空转）
 *   因此两条断言必须**一起**存在，缺一即失败。
 */
const HERE = __dirname
const SCENE = readFileSync(join(HERE, '..', 'particles', 'ParticleScene.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('暂停帧循环 · 省电与出画必须成对', () => {
  it('① 纯函数层：暂停且可见必须是 demand（省电的一半）', () => {
    expect(resolveFrameloop(false, true)).toBe('demand')
  })

  it('② 组件层：必须存在帧泵，且在暂停时启用（出画的一半）', () => {
    const body = stripComments(SCENE)
    expect(body, '未找到 PausedFramePump 组件').toMatch(/function PausedFramePump\(/)
    // ★ 挂载点必须是**裸的** JSX 元素。
    //   不能用"源码里出现过 `<PausedFramePump active={...}/>`"这种断言 ——
    //   把它包进 `{false && …}` 仍然匹配，测试照样绿（实测过，会漏）。
    //   因此要求：元素**直接**出现在 return 的 JSX 里、前面没有 `&&` 或 `?`。
    const mount = body.match(/<PausedFramePump active=\{documentVisible && !isPlaying\} \/>/)
    expect(mount, '未在暂停时挂载帧泵').toBeTruthy()
    const at = body.indexOf(mount![0])
    // 往前看同一行/上一行的行首：若被 `{false &&` / `{cond &&` / 三元包着，说明是条件禁用
    const lineStart = body.lastIndexOf('\n', at) + 1
    const prefix = body.slice(lineStart, at)
    expect(prefix.trim(), '帧泵被条件包住 —— 等于没挂').toBe('')
  })

  it('③ 帧泵必须真的调用 invalidate（否则仍会黑屏）', () => {
    const body = stripComments(SCENE)
    // 从 R3F 取出 invalidate
    expect(body).toMatch(/const \{ invalidate \} = useThree\(\)/)
    const fn = body.slice(body.indexOf('function PausedFramePump('))
    const end = fn.indexOf('\n}')
    const pump = fn.slice(0, end)
    expect(pump, '帧泵没有调用 invalidate —— demand 下不会出画（黑屏事故）').toMatch(/invalidate\(\)/)
    // 必须是节流调用（不是每帧都 invalidate，那样等于退回满帧空转）
    expect(pump, '帧泵没有节流 —— 等于没省电').toMatch(/intervalMs/)
    expect(pump).toMatch(/PAUSED_TARGET_FPS/)
  })

  it('④ 帧泵必须用 rAF 而非 setInterval（标签页隐藏时自动停摆）', () => {
    const body = stripComments(SCENE)
    const fn = body.slice(body.indexOf('function PausedFramePump('))
    const pump = fn.slice(0, fn.indexOf('\n}'))
    expect(pump).toMatch(/requestAnimationFrame/)
    expect(pump, 'setInterval 在隐藏标签页仍会触发').not.toMatch(/setInterval/)
  })

  it('⑤ 帧泵必须在卸载时取消 rAF（红线 22：单例/句柄必须清理）', () => {
    const body = stripComments(SCENE)
    const fn = body.slice(body.indexOf('function PausedFramePump('))
    const pump = fn.slice(0, fn.indexOf('\n}'))
    expect(pump, '未清理 rAF 句柄').toMatch(/cancelAnimationFrame\(raf\)/)
  })

  it('⑥ 帧泵的启停必须随 active 变化（播放后不得继续按 24fps 泵）', () => {
    const body = stripComments(SCENE)
    const fn = body.slice(body.indexOf('function PausedFramePump('))
    const pump = fn.slice(0, fn.indexOf('\n}'))
    // effect 依赖必须含 active，且开头有 early-return
    expect(pump).toMatch(/if \(!active\) return/)
    expect(pump).toMatch(/\}, \[active, invalidate\]\)/)
  })

  it('⑦ 帧率常量与上游非播放档一致（24）', () => {
    expect(PAUSED_TARGET_FPS).toBe(24)
  })
})
