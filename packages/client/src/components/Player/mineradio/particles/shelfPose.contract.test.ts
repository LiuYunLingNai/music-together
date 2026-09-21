import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：侧栏卡片基准位姿必须包含上游的**出厂偏移**与**尺寸**。
 *
 * ============================ 真实缺陷 ============================
 *
 * 上游 `shelfLayoutProfile()`（`04-shelf/00-layout-hover.js:35-45`）在基础
 * 三元组之外**再加用户偏移**，出厂值见 `00-state/04-fx-defaults.js:157-160`：
 *
 *   shelfSize 0.92 / shelfOffsetX −0.34 / shelfOffsetY −0.20 / shelfOffsetZ +0.12
 *
 * 而 `sideY` 的基础值是 0（非 skull 档），因此 `sideY` 出厂即 **−0.20**。
 *
 * 此前移植只照搬了基础三元组（`3.18 / 0.86 / scale 1`），把四项出厂偏移
 * 整个漏掉 —— 后果：
 *   · 整列卡片偏右 0.34、偏上 0.20、偏后 0.12
 *   · 每张卡片**大 8.7%**（侧栏缩放 1 vs 出厂 0.92）
 * 相对固定的跟拍机位（`lookAt(2.32, 0, 0.72)` / `radius 4.2`）这是可见的
 * 位置与比例偏差。
 *
 * 本测试从源码常量重推，钉住"偏移与尺寸确实被应用"这一性质。
 */
const CARD_SOURCE = readFileSync(join(__dirname, 'floatingSongCard.ts'), 'utf8')

describe('歌单架卡片基准位姿（上游 shelfLayoutProfile 出厂偏移）', () => {
  it('出厂偏移与尺寸常量齐全', () => {
    expect(CARD_SOURCE).toMatch(/SHELF_CENTER\s*=\s*\{\s*x:\s*-0\.34,\s*y:\s*-0\.2,\s*z:\s*0\.12\s*\}/)
    expect(CARD_SOURCE).toMatch(/SHELF_SIZE\s*=\s*0\.92/)
  })

  it('三轴偏移都被实际应用（不是定义了却不用）', () => {
    // sideX 必须加上 x 偏移
    expect(CARD_SOURCE).toMatch(/const sideX = \([^)]*\) \+ SHELF_CENTER\.x/)
    // sideY 必须取 y 偏移，并进入 position.y 的合成
    expect(CARD_SOURCE).toMatch(/const sideY = SHELF_CENTER\.y/)
    expect(CARD_SOURCE).toMatch(/sideY \+/)
    // z 偏移必须进入 position.z 的合成
    expect(CARD_SOURCE).toMatch(/SHELF_CENTER\.z -/)
  })

  it('缩放必须乘上出厂 size（卡片不应比上游大 8.7%）', () => {
    expect(CARD_SOURCE).toMatch(/const sideScale = \([^)]*\) \* SHELF_SIZE/)
  })
})
