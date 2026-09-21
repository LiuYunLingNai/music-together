import { describe, expect, it } from 'vitest'
import {
  SHELF_CULL_DISTANCE,
  SHELF_MAX_RENDER,
  SHELF_VISIBLE_RADIUS,
  computeShelfWindow,
} from './shelfWindow'

/**
 * 回归：歌单架回收窗口必须满足三条用户实测的不变量。
 *
 * 覆盖的真实缺陷（详见 `shelfWindow.ts` 顶部）：
 *   ① 只能滚到固定条数内 → 跟不上当前曲目
 *   ② 窗口锚点夹在端点 → 当前歌贴边时一侧全空
 *   ③ 滚动越界 → 显示空白
 *
 * 这些断言用**真实取值**遍历，不靠正则匹配源码文本。
 */
describe('歌单架 · 回收窗口（上游 syncRenderedWindow）', () => {
  const QUEUE_LENGTHS = [1, 2, 3, 6, 11, 12, 24, 25, 100, 200]

  it('渲染预算是上游固定值 11（= 半径 5 的 ±1），与画质档无关', () => {
    expect(SHELF_VISIBLE_RADIUS).toBe(5)
    expect(SHELF_MAX_RENDER).toBe(11)
  })

  it('② 居中那张卡**永远**在窗口内（结构性保证：不依赖缓动收敛）', () => {
    for (const total of QUEUE_LENGTHS) {
      for (let c = 0; c < total; c++) {
        const { start, end } = computeShelfWindow(c, total)
        expect(c, `total=${total} center=${c} window=[${start},${end}]`).toBeGreaterThanOrEqual(start)
        expect(c).toBeLessThanOrEqual(end)
      }
    }
  })

  it('② 居中卡还必须在剔除距离内（否则"在窗口里却看不见"＝空白）', () => {
    for (const total of QUEUE_LENGTHS) {
      for (let c = 0; c < total; c++) {
        const { start, end } = computeShelfWindow(c, total)
        // 窗口半径必须严格小于剔除距离，二者才不会互相打架
        for (let i = start; i <= end; i++) {
          if (i === Math.round(c)) expect(Math.abs(i - c)).toBeLessThan(SHELF_CULL_DISTANCE)
        }
      }
    }
    // 结构性条件：窗口半径 < 剔除半径
    expect(SHELF_VISIBLE_RADIUS).toBeLessThan(SHELF_CULL_DISTANCE)
  })

  it('② 缓动途中也不空：任意平滑路径上居中卡都在窗口内且未被剔除', () => {
    for (const total of QUEUE_LENGTHS) {
      for (let target = 0; target < total; target++) {
        for (const from of [target - 20, target - 1, target, target + 1, target + 20]) {
          if (from < 0 || from >= total) continue
          let smooth = from
          for (let frame = 0; frame < 200; frame++) {
            smooth += (target - smooth) * 0.16
            if (Math.abs(smooth - target) < 0.001) smooth = target
            const { start, end } = computeShelfWindow(smooth, total)
            const centered = Math.round(smooth)
            expect(centered).toBeGreaterThanOrEqual(start)
            expect(centered).toBeLessThanOrEqual(end)
            expect(Math.abs(centered - smooth)).toBeLessThan(SHELF_CULL_DISTANCE)
            if (smooth === target) break
          }
        }
      }
    }
  })

  it('窗口始终夹在 [0, total-1] 内，不会出现内容之外的空槽', () => {
    for (const total of QUEUE_LENGTHS) {
      for (const c of [-100, -1, 0, 1, total / 2, total - 1, total, total + 100]) {
        const { start, end, count } = computeShelfWindow(c, total)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(end).toBeLessThanOrEqual(total - 1)
        expect(count).toBeGreaterThan(0)
        expect(count).toBeLessThanOrEqual(SHELF_MAX_RENDER)
        expect(count).toBe(end - start + 1)
      }
    }
  })

  it('窗口尽量凑满上限（末端对齐），短队列则整条显示', () => {
    // 长队列、中心在中段 → 满窗口
    expect(computeShelfWindow(50, 100)).toEqual({ start: 45, end: 55, count: 11 })
    // 短于上限的队列 → 全部显示
    expect(computeShelfWindow(0, 3)).toEqual({ start: 0, end: 2, count: 3 })
    expect(computeShelfWindow(5, 11)).toEqual({ start: 0, end: 10, count: 11 })
  })

  it('① 队列末端也能凑满窗口（当前歌是最后一首时不贴边）', () => {
    // total=100, center=99 → 窗口应是 [89,99]，当前歌在**末位但窗口是满的**
    const { start, end, count } = computeShelfWindow(99, 100)
    expect(count).toBe(SHELF_MAX_RENDER)
    expect(end).toBe(99)
    expect(start).toBe(89)
    // 上方有 10 首可见（旧实现此处 above=0，一侧全空）
    expect(99 - start).toBe(10)
  })

  it('① 队列首端同理', () => {
    const { start, end, count } = computeShelfWindow(0, 100)
    expect(count).toBe(SHELF_MAX_RENDER)
    expect(start).toBe(0)
    expect(end).toBe(10)
  })

  it('畸形输入不产生 NaN / 负窗口', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const w = computeShelfWindow(bad, 50)
      expect(Number.isFinite(w.start)).toBe(true)
      expect(Number.isFinite(w.end)).toBe(true)
      expect(w.count).toBeGreaterThan(0)
    }
    // 空队列
    expect(computeShelfWindow(0, 0)).toEqual({ start: 0, end: -1, count: 0 })
  })
})

/**
 * ③ 滚动夹取：范围是**整条队列**，不是窗口。
 *
 * 上游 `step()`（`01-manager-core.js:679`）：
 *   `centerTarget = Math.max(0, Math.min(allItems.length - 1, centerTarget + direction))`
 */
describe('歌单架 · 滚动夹取到整条队列', () => {
  const step = (current: number, direction: number, total: number) =>
    Math.max(0, Math.min(total - 1, current + direction))

  it('③ 顶部再向上滚不会越界', () => {
    let t = 0
    for (let i = 0; i < 3; i++) t = step(t, -1, 100)
    expect(t).toBe(0)
  })

  it('③ 底部再向下滚不会越界', () => {
    let t = 99
    for (let i = 0; i < 3; i++) t = step(t, 1, 100)
    expect(t).toBe(99)
  })

  it('① 可以逐格滚到队列**任意**一首（不受渲染预算限制）', () => {
    const total = 200
    let t = 0
    for (let i = 0; i < total - 1; i++) t = step(t, 1, total)
    expect(t).toBe(total - 1)
    // 全程窗口都有效（说明任何位置都有内容可显示）
    for (let c = 0; c < total; c++) {
      expect(computeShelfWindow(c, total).count).toBeGreaterThan(0)
    }
  })

  it('未居中时任意位置滚动结果始终合法', () => {
    for (const total of [1, 2, 11, 100]) {
      for (let c = 0; c < total; c++) {
        for (const dir of [-1, 1]) {
          const next = step(c, dir, total)
          expect(next).toBeGreaterThanOrEqual(0)
          expect(next).toBeLessThanOrEqual(total - 1)
        }
      }
    }
  })
})
