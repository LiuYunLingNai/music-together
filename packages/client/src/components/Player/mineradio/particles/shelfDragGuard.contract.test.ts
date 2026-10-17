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
 * ============================ 这条守卫的定性变迁 ============================
 *
 * 最初它是「因未移植召唤包络而产生的必要补偿」（HANDOFF §2 D11）：
 * 上游歌单架出厂自动隐藏，跟拍入口 `isSideShelfFocusHit` 要求
 * `shelfVisibility > 0.34`（`05-card-interactions.js:19`），平时不满足；
 * 而本项目当时常驻可见，那个隐含门槛不存在，于是必须显式补。
 *
 * **召唤包络移植后，上游那条隐含门槛已经恢复**（`shelfFocusEntryUnlocked`），
 * 这条守卫的性质随之改变 —— 但它**仍然必须保留**，理由与上游同源：
 * `canShowShelfHoverCueAt`（00-layout-hover.js:127）把 `isPointerOverUi`
 * 列为否决项；本项目对应的是"指针正被拖拽手势占用"。方案一（浮现即跟拍）
 * 之后跟拍来源多了一条 `shelfVisible && inShelfHoldZone`，拖拽期间
 * `inShelfHoldZone` 为假，仍不会误触 —— 守卫从"必要补偿"变成
 * "与上游同源的语义"，但强度不能降。
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
    // 跟拍进入路径必须仍然存在，且不依赖 rotating。
    //
    // ★ 这条断言随方案一（浮现即跟拍）改过形状：`shouldFocus` 现在是
    //   「(hoverCue 停留 260ms) ‖ (已浮现 ∧ 指针在右侧宽区)」两个来源的析取，
    //   两者都不得把 `rotating` 写进条件 —— 拖拽期间 `cardHit` /
    //   `inShelfHoldZone` 已各自为假，这里再加就是重复门控。
    expect(body).toMatch(/const shouldFocus =/)
    expect(body).toMatch(/hoverCue\.zoneActive && now - hoverCue\.enteredAt > 260/)
    expect(body).toMatch(/setShelfCameraFocus\(true\)/)
    // 浮现这条来源必须真的在（方案一的核心）
    expect(body, '浮现→跟拍 的来源缺失').toMatch(/shelfVisible && inShelfHoldZone/)
    // inZone 的合成不得直接把 rotating 变成硬性 return / 早退
    expect(body).not.toMatch(/if \(rotating\) return/)
    // 退出路径同样不得读 rotating（松手即按正常 exitTimer 走）
    expect(body, '退出路径被 rotating 门控').not.toMatch(/const shouldExit =[^\n]*rotating/)
  })
})
