import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：换行后的**上下文淡入包络** `contextIntro`
 * （上游 `02-visual/14-stage-lyrics-rendering.js` :2362-2363，消费方在
 * `02-visual/12-lyrics-row-layers.js` :1329 / :1520 / :2413）。
 *
 * ============================ 曾经的偏差 ============================
 *
 * 上游：
 *
 *   contextIntro = clampRange((age - 0.04) / 0.48, 0, 1)      // :2362
 *   contextIntro = contextIntro² × (3 - 2 × contextIntro)     // :2363 smoothstep
 *
 * 它有两个去向，本项目此前**两个都缺**：
 *
 *   a. `updateLyricRowLayers(..., { contextIntro })`（:2394）→ 在行层里
 *      （:1329 取参、:1520 使用）：
 *        motionAnchor = isActive || currentTranslation
 *        rowIntro     = motionAnchor ? 1 : contextIntro
 *        target       = opacity × (isActive ? 1 : contextAlpha) × rowIntro × visibleFade
 *      即换行后**非锚定行**从 0 淡入。缺它 ⇒ 上下文行在换行瞬间就是满亮度，
 *      是硬切，没有"新的一屏上下文渐渐浮出来"。
 *      激活行自己有滑入包络（组级 groupASmooth），所以只有上下文行是硬切。
 *
 *   b. 同时决定行层的 `baseEase`（:2413）：
 *        ease = contextIntro < 0.98 ? 0.19 : 0.135
 *      淡入期间位置/缩放**追得更快**（0.19），稳定后放慢到 0.135。
 *      本项目两处行层都写死 `0.16` —— 既不是淡入档也不是稳定档：
 *      换行时跟得偏慢、稳定后又偏快。
 *
 * ★ 上游 :2366-2388 的 `data.contextMat` / `data.context` 分支
 *   （含组级 `contextY` / `contextScale`）**有意不移植**：
 *   `data.context` 在 `13-lyrics-mesh-build.js:77-78` 声明后从未被赋值，
 *   `data.contextMat` 恒为 null，那一段在行层架构下是死代码
 *   （与 sun/glow/sparks 同类，见 `ensureRowGlow` 处说明）。
 *   逐行架构里的等价物是已移植的逐行 `rowDrift` 与 `floatScaleWobble`
 *   —— 见 `lyricRowDrift.contract.test.ts`。
 *
 * ★ `age` 的计时起点：上游 `mesh.userData.age` 在换行时置 0
 *   （`userData.age = 0`）。本项目用 `groupAgeRef`，且在**激活行索引**
 *   变化时归零 —— 用索引而不是滚动量，滚到一半时行没变，包络不该重来。
 */
const SOURCE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('上下文淡入包络 contextIntro 的计算（上游 :2362-2363）', () => {
  const body = stripComments(SOURCE)

  it('按上游的 0.04 延迟 / 0.48 包络 + smoothstep 计算', () => {
    expect(body).toMatch(
      /const contextIntroRaw = Math\.max\(0, Math\.min\(1, \(groupAgeRef\.current - 0\.04\) \/ 0\.48\)\)/,
    )
    // 必须是 smoothstep，不是线性 —— 上游 :2363 明确是 x²(3−2x)
    expect(body).toMatch(/const contextIntro = smoothstep\(contextIntroRaw\)/)
  })

  it('smoothstep 本体是 x²(3−2x)（与上游 :2363 逐字一致）', () => {
    expect(body).toMatch(/return x \* x \* \(3 - 2 \* x\)/)
  })

  it('换行时组级 age 归零，且用激活行索引判换行', () => {
    // 用索引判而不是滚动量：滚到一半时行没变，包络不该重来
    expect(body).toMatch(
      /if \(runtimeRef\.current\.activeIndex !== lastActiveIndexRef\.current\) \{[\s\S]{0,120}?groupAgeRef\.current = 0/,
    )
    expect(body).toMatch(/groupAgeRef\.current \+= dt/)
  })
})

describe('baseEase 两档（上游 :2413）', () => {
  const body = stripComments(SOURCE)

  it('主行段算出 rowBaseEase 并喂给两条链', () => {
    expect(body).toMatch(/const rowBaseEase = contextIntro < 0\.98 \? 0\.19 : 0\.135/)
    expect(body).toMatch(
      /const ease = 1 - Math\.pow\(1 - rowBaseEase, Math\.min\(3, Math\.max\(0\.25, dt \* 60\)\)\)/,
    )
  })

  it('译词行链自己也按同一分档算（不再共用主行的 ease）', () => {
    expect(body).toMatch(/const rowEaseBase = contextIntroForRow < 0\.98 \? 0\.19 : 0\.135/)
    expect(body).toMatch(/const ease = 1 - Math\.pow\(1 - rowEaseBase, frameScale\)/)
  })

  it('不得再写死 0.16（既非淡入档也非稳定档）', () => {
    expect(body).not.toMatch(/1 - Math\.pow\(1 - 0\.16,/)
  })
})

describe('rowIntro 的消费（上游 :1520 / :1597）', () => {
  const body = stripComments(SOURCE)

  it('主行：锚定行豁免，其余乘 contextIntro', () => {
    expect(body).toMatch(/const rowIntro = isActive \? 1 : contextIntro/)
    expect(body).toMatch(/const opacityTarget = contextAlpha \* depthFade \* rowIntro/)
  })

  it('译词行：只有当前译词行豁免，其余同样淡入', () => {
    // 译词行永不 isActive，所以上游 motionAnchor 落在 currentTranslation 上
    expect(body).toMatch(/const rowIntro = isCurrentParent \? 1 : contextIntroForRow/)
    expect(body).toMatch(/const opacityTarget = targetAlpha \* depthFade \* rowIntro/)
  })

  it('stepRow 的签名收下 contextIntroForRow（两条链共用同一份包络）', () => {
    expect(body).toMatch(/contextIntroForRow: number,/)
    // 调用处必须是实参列表的**最后一项**（主行段算一次，全部行共用）。
    // ★ 用 \r? 兼容 CRLF：这个文件是 CRLF 行尾，裸 \n 匹配不到。
    expect(body).toMatch(/\r?\n\s+contextIntro,\r?\n\s+\)/)
  })
})
