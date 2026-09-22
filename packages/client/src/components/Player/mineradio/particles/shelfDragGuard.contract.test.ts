import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：**拖拽转物体期间不得进入歌单架跟拍**。
 *
 * ============================ 真实缺陷 ============================
 *
 * 用户实测："旋转封面的时候如果鼠标误触碰到歌曲架的判定，会进入歌曲架的
 * 相机"。拖拽转物体是"按住并大幅划动"的手势，指针很容易扫过右侧热区；
 * 热区宽达视口 18%（保持区更达 **56%**），260ms 停留门槛在慢速划动下会被
 * 满足 → 相机突然被拉去跟拍，打断正在进行的旋转。
 *
 * **为什么上游没这个显式守卫**：上游歌单架默认**自动隐藏**
 * （`fx.shelfPresence` 出厂 `'auto'`），跟拍入口 `isSideShelfFocusHit`
 * 要求 `shelfVisibility > 0.34`（`05-card-interactions.js:19`）——
 * 平时不满足，误触概率极低。
 *
 * 而本项目**未移植悬停召唤包络**（HANDOFF §5.1），歌单架**常驻可见**，
 * 那个隐含门槛不存在 → 同样的手势就会误触。因此这条守卫是"因未移植项
 * 而产生的必要补偿"（登记于 HANDOFF §2 D11）。
 *
 * 本测试读源码断言守卫存在，并**同时**断言"松手后仍能正常进入跟拍"
 * （避免有人把守卫写成永久禁用）。
 */
const SHELF_SOURCE = readFileSync(join(__dirname, 'FloatingSongShelf.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('歌单架跟拍：拖拽期间不得误触', () => {
  const body = stripComments(SHELF_SOURCE)

  it('跟拍判定必须读取 orbitCameraState.rotating', () => {
    expect(body).toMatch(/orbitCameraState\.rotating/)
  })

  it('卡片命中与保持区都必须被拖拽状态门控', () => {
    // cardHit：!pointerOverUi && !rotating && raycast...
    expect(body, 'cardHit 未被 rotating 门控').toMatch(/const cardHit =[^\n]*!rotating[^\n]*raycastCardAt/)
    // inShelfHoldZone：!pointerOverUi && !rotating && (热区 || 预览使用区)
    expect(body, 'inShelfHoldZone 未被 rotating 门控').toMatch(
      /const inShelfHoldZone =[\s\S]{0,120}!rotating[\s\S]{0,120}isInShelfHotZone/,
    )
  })

  it('守卫不得写成永久禁用（松手后仍能进入跟拍）', () => {
    // 跟拍进入路径必须仍然存在，且不依赖 rotating
    expect(body).toMatch(/const shouldFocus = hoverCue\.zoneActive && now - hoverCue\.enteredAt > 260/)
    expect(body).toMatch(/setShelfCameraFocus\(true\)/)
    // inZone 的合成不得直接把 rotating 变成硬性 return / 早退
    expect(body).not.toMatch(/if \(rotating\) return/)
  })
})
