import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：可读性层 / 辉光层的 **renderOrder** 逐行跟随
 * （上游 `02-visual/12-lyrics-row-layers.js` 的 :550 / :1680 / :1716）。
 *
 * ============================ 曾经的偏差 ============================
 *
 * 上游对这两层的 renderOrder 都是**每帧重写**的，而且与建行时的初值不同：
 *
 *   建行（:550）  readability.renderOrder = row.mesh.renderOrder - 0.05;
 *   逐帧（:1680） row.readability.renderOrder = row.mesh ? row.mesh.renderOrder - 0.04 : …;
 *
 *   建行（:344）  glow.renderOrder = row.isTranslation ? 42.98 : 42.48;   ← 已分档
 *   逐帧（:1716） row.glow.renderOrder = row.isTranslation ? (renderBase - 0.02) : (renderBase - 0.52);
 *
 * 本项目此前：
 *   · 可读性层只写了建行时的 `- 0.05`，逐帧那一行没有 —— 于是恒比上游低 0.01。
 *     主行 renderOrder 是逐行递变的（`42.6 − dist×0.015`），可读性层与文字层的
 *     相对次序本该跟着走，实际却固定低半档。
 *   · 辉光层两档（主行 / 译词行）**共用 42.48**。上游译词行是 42.98
 *     （renderBase − 0.02），即译词辉光排在**文字之上**；主行 42.48
 *     （renderBase − 0.52）排在文字之下。译词更小更淡，让它的晕从字面上方
 *     漫出来才不会把父行的字压暗 —— 共用一档时译词辉光被父行文字盖住一截。
 *
 * ★ 所有 renderOrder 都带同一个 `RENDER_ORDER_OFFSET`（+258），那是为了压过
 *   本项目的卡片中心卡（300）；行间**相对**关系必须与上游逐项一致，
 *   所以这里断言的是偏移前的裸值。
 */
const SOURCE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('可读性层 renderOrder 逐帧跟随（上游 :1680）', () => {
  const body = stripComments(SOURCE)

  it('主行可读性层每帧写成 mesh.renderOrder − 0.04（不是只建行时写 −0.05）', () => {
    expect(body).toMatch(/row\.readability\.renderOrder = mesh\.renderOrder - 0\.04/)
  })

  it('译词行可读性层同样每帧跟随', () => {
    // 上游 :1680 对 translation 行一样是 `- 0.04`（else 支是 renderBase，
    // 仅在 row.mesh 缺失时走，逐行架构下恒有 mesh）
    const count = (body.match(/row\.readability\.renderOrder = mesh\.renderOrder - 0\.04/g) ?? []).length
    expect(count, '主行与译词行两条链都要跟随').toBe(2)
  })

  it('建行时的初值仍是上游的 −0.05（:550，不得改成 −0.04 冒充逐帧值）', () => {
    expect(body).toMatch(/readability\.renderOrder = row\.mesh\.renderOrder - 0\.05/)
  })
})

describe('辉光层 renderOrder 分档（上游 :1716）', () => {
  const body = stripComments(SOURCE)

  it('建行时按 isTranslation 分 42.98 / 42.48 两档', () => {
    expect(body).toMatch(/glow\.renderOrder = \(row\.isTranslation \? 42\.98 : 42\.48\) \+ RENDER_ORDER_OFFSET/)
  })

  it('译词辉光每帧写成 42.98（上游 renderBase − 0.02，排在文字之上）', () => {
    expect(body).toMatch(/row\.glow\.renderOrder = 42\.98 \+ RENDER_ORDER_OFFSET/)
  })

  it('不得再把两档共用 42.48（曾经的偏差）', () => {
    // 曾经的写法：`glow.renderOrder = 42.48 + RENDER_ORDER_OFFSET`（无条件）
    expect(body).not.toMatch(/glow\.renderOrder = 42\.48 \+ RENDER_ORDER_OFFSET/)
  })
})
