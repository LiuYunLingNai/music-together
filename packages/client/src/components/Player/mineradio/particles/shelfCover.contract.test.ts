import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：封面异步加载完成时，**不得**回放旧闭包，也不得丢掉这次重绘。
 *
 * ============================ 真实缺陷 ============================
 *
 * 卡片纹理是"固定槽位池 + 逐帧重绑定到队列序号"（上游 `syncRenderedWindow`
 * 的等价物）。封面是异步加载的（`requestCover`），因此绘制时登记的回调
 * 可能在**槽位已被回收给另一首歌**之后才触发。
 *
 * 两种错误写法都会坏，而且症状不同：
 *
 *   ① 无守卫（最早）：回调里直接 `drawFloatingSongCard(旧 item)` ——
 *      快速滚动/切歌后会**偶发显示上一首的封面与文字**。
 *
 *   ② 守卫 = "drawKey 变了就 return"（中间版本）：避免了旧数据覆盖新内容，
 *      但**会漏掉这次封面就绪**。原因是 `requestCover` 在封面仍处于
 *      `'loading'` 时会**直接 return 并丢弃新回调** —— 于是加载完成时
 *      触发的仍是旧闭包，旧闭包一发现 drawKey 已变就什么都不画。若此后
 *      drawKey 不再变化（非当前歌卡片 `progress` 恒为 0），封面就
 *      **永远不会出现**，只剩暗色占位块。
 *
 * 正确写法（本用例钉住）：回调**只标脏**（`coverDirtyRef[slotIndex] = true`），
 * 由渲染循环用**当前**的 item/color/hover 重绘。这样两个目标同时满足：
 * 不用旧数据覆盖新内容，也不会漏掉封面就绪。
 *
 * 静态检查：读源码断言结构。运行时行为由人工验收兜底（见 HANDOFF §7）。
 */
const SHELF_SOURCE = readFileSync(join(__dirname, 'FloatingSongShelf.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('歌单架卡片 · 封面异步就绪契约', () => {
  const body = stripComments(SHELF_SOURCE)

  it('存在按槽位的封面脏标记，且参与绘制判定', () => {
    expect(body).toMatch(/coverDirtyRef\s*=\s*useRef<boolean\[\]>/)
    // 必须进入绘制条件（否则标脏无人消费）
    expect(body).toMatch(/drawKey\s*!==\s*drawKeysRef\.current\[slotIndex\]\s*\|\|\s*coverDirtyRef\.current\[slotIndex\]/)
  })

  it('绘制后必须清掉脏标记（否则每帧重绘）', () => {
    const idx = body.indexOf('coverDirtyRef.current[slotIndex] = false')
    expect(idx, '未找到清除脏标记的语句').toBeGreaterThan(-1)
  })

  it('封面回调只标脏，不得回放闭包里的绘制', () => {
    // 取 onCoverReady 回调（绘制调用的最后一个实参）
    const drawIdx = body.indexOf('drawFloatingSongCard(')
    expect(drawIdx).toBeGreaterThan(-1)
    const tail = body.slice(drawIdx, body.indexOf('card.texture.needsUpdate', drawIdx))
    // 回调体应当是 `() => { coverDirtyRef.current[slotIndex] = true }`
    expect(tail).toMatch(/coverDirtyRef\.current\[slotIndex\]\s*=\s*true/)
    // 且回调体内**不得**再调用绘制（那正是"回放旧闭包"）
    const callbackIdx = tail.indexOf('coverDirtyRef.current[slotIndex] = true')
    const callbackTail = tail.slice(callbackIdx)
    expect(callbackTail).not.toMatch(/drawFloatingSongCard\s*\(/)
  })

  it('脏标记数组必须随 mesh 池同步增删、并在卸载时清空', () => {
    // 池增长
    expect(body).toMatch(/coverDirtyRef\.current\.push\(false\)/)
    // 池收缩
    expect(body).toMatch(/coverDirtyRef\.current\.pop\(\)/)
    // 卸载清理（StrictMode 重放后不得残留，否则新槽位读到旧脏标记）
    expect(body).toMatch(/coverDirtyRef\.current\s*=\s*\[\]/)
  })
})
