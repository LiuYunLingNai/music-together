import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHELF_PORTRAIT_ASPECT, isNarrowShelfViewport, isPortraitShelfViewport, shelfSideX } from './floatingSongCard'

/**
 * 回归：歌单架的**分档判据必须同源**（§5.4 C4）。
 *
 * ============================ 真实缺陷 ============================
 *
 * 上游 `isPortraitShelfViewport()`（`04-shelf/00-layout-hover.js:24-26`）是
 *
 *     innerHeight > innerWidth * 1.08      ← **带 1.08 系数**
 *
 * 而 `shelfLayoutProfile()` 用它**同时**决定 `sideX` 档位与卡片姿势（`:28-46`）。
 *
 * 本项目此前两处判据**不一致**：
 *   · `floatingSongCard.ts`（`shelfSideX` + `applyFloatingSongCardPose`）用裸 `height > width`
 *   · `FloatingSongShelf.tsx` 的热区判定用上游的 `* 1.08`
 *
 * 后果：在 **1.00–1.08** 这个比例带里，卡片姿势走竖屏档、热区却走横屏档 ——
 * 卡片列位置与命中区域错档（点不中、跟拍错位）。
 *
 * 现在三处统一走本模块导出的 `isPortraitShelfViewport`，本文件钉住这一点。
 */
const HERE = __dirname
const CARD_SRC = readFileSync(join(HERE, 'floatingSongCard.ts'), 'utf8')
const SHELF_SRC = readFileSync(join(HERE, 'FloatingSongShelf.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('歌单架分档判据 · 语义', () => {
  it('★ 竖屏阈值必须含上游的 1.08 系数（裸 height>width 是错的）', () => {
    expect(SHELF_PORTRAIT_ASPECT).toBe(1.08)
    // 1000×1050：高 > 宽但**不到** 1.08 倍 —— 上游判为横屏
    expect(isPortraitShelfViewport({ width: 1000, height: 1050 })).toBe(false)
    // 1000×1081：刚过 1.08 倍 —— 上游判为竖屏
    expect(isPortraitShelfViewport({ width: 1000, height: 1081 })).toBe(true)
    // 边界：恰好等于 1.08 倍不算竖屏（上游是严格大于）
    expect(isPortraitShelfViewport({ width: 1000, height: 1080 })).toBe(false)
  })

  it('典型设备判档正确', () => {
    expect(isPortraitShelfViewport({ width: 390, height: 844 })).toBe(true) // 手机竖屏
    expect(isPortraitShelfViewport({ width: 1600, height: 900 })).toBe(false) // 桌面
    expect(isPortraitShelfViewport({ width: 1024, height: 1366 })).toBe(true) // 平板竖屏
    expect(isPortraitShelfViewport({ width: 1366, height: 1024 })).toBe(false) // 平板横屏
  })

  it('窄屏 = 横屏 且 宽度 < 980（上游 nailLayoutProfile 的 narrow）', () => {
    expect(isNarrowShelfViewport({ width: 900, height: 600 })).toBe(true)
    expect(isNarrowShelfViewport({ width: 1200, height: 800 })).toBe(false)
    // 竖屏永远不是 narrow（上游 `!portrait && width < 980`）
    expect(isNarrowShelfViewport({ width: 500, height: 900 })).toBe(false)
  })

  it('三档 sideX 与上游一致', () => {
    expect(shelfSideX({ width: 390, height: 844 })).toBe(1.56)
    expect(shelfSideX({ width: 900, height: 600 })).toBe(2.48)
    expect(shelfSideX({ width: 1600, height: 900 })).toBe(3.18)
  })

  it('★ 1.00–1.08 比例带必须与热区判定**同档**（此前会错档）', () => {
    // 这一带正是"裸 >" 与 "*1.08" 分歧的地方：必须都判横屏
    for (const [w, h] of [
      [1000, 1010],
      [1000, 1050],
      [1000, 1080],
    ] as const) {
      expect(isPortraitShelfViewport({ width: w, height: h }), `${w}x${h} 应判横屏`).toBe(false)
      // 横屏档 ⇒ 若宽度 < 980 则 narrow，否则宽屏档。取宽屏档验证它不是竖屏值 1.56
      expect(shelfSideX({ width: w, height: h })).not.toBe(1.56)
    }
  })
})

describe('歌单架分档判据 · 接线契约（必须同源）', () => {
  it('① `shelfSideX` 与卡片姿势必须走共享判据，不得自己写裸比较', () => {
    const body = stripComments(CARD_SRC)
    // 导出共享判据
    expect(body).toMatch(/export function isPortraitShelfViewport/)
    expect(body).toMatch(/export function isNarrowShelfViewport/)
    expect(body).toMatch(/export const SHELF_PORTRAIT_ASPECT = 1\.08/)
    // ★ 不得再出现裸 `height > width`（那正是错档的来源）
    expect(body, 'shelfSideX/姿势 又写回了裸比较 —— 会与热区错档').not.toMatch(/height\s*>\s*\w*\.?width\b(?!\s*\*)/)
    // 两处都调用共享判据
    const calls = body.match(/isPortraitShelfViewport\(/g) ?? []
    expect(calls.length, '至少 shelfSideX 与 applyFloatingSongCardPose 两处要调用').toBeGreaterThanOrEqual(2)
  })

  it('② `FloatingSongShelf` 必须复用同一判据，不得再本地定义一份', () => {
    const body = stripComments(SHELF_SRC)
    // 必须从 floatingSongCard 引入（import 是多行列表，先定位其来源模块）
    const importBlock = body.slice(0, body.indexOf("from './floatingSongCard'"))
    expect(importBlock, '未从 floatingSongCard 引入共享判据').toMatch(/isPortraitShelfViewport/)
    // 不得再本地定义
    expect(body, '又本地定义了一份竖屏判定 —— 会再次分叉').not.toMatch(/function isPortraitShelfViewport/)
    // 不得再出现裸的 1.08 字面量（阈值只应出现在 floatingSongCard）
    expect(body, '1.08 阈值散落在调用方').not.toMatch(/1\.08/)
  })
})
