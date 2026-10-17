import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：上下文行的**进度漂移**（上游
 * `02-visual/12-lyrics-row-layers.js` 的 :1431 / :1599 / :1606，
 * 驱动源在 `02-visual/14-stage-lyrics-rendering.js:2396`）。
 *
 * ============================ 曾经的偏差 ============================
 *
 * 上游对**非锚定行**（`motionAnchor = isActive || currentTranslation`）有一项
 * 随当前行逐字进度整体上下移动的位移，本项目此前整个缺失 —— 只有组级的
 * `progressLift`（那是**组**的位移，所有行一起动）：
 *
 *   行级（:1599）:
 *     rowDrift = (0.5 − shownProgress) × contextDrift × motionBlend
 *     yTarget  = −liveDelta × lineStepWorld
 *              + (motionAnchor ? 0 : rowDrift × clampRange(0.70 + |Δ|×0.10, 0.65, 1.20))
 *   z 上还有一项（:1606）:
 *     zTarget = zBase − (motionAnchor ? 0 : |rowDrift| × 0.18) + …
 *
 * 即上下文行会随当前句的填充**反向呼吸**：进度 0 时 +contextDrift/2、
 * 进度 1 时 −contextDrift/2、过半时归零。出厂风格 `float` 的
 * contextDrift = 0.120，|Δ| = 1 的行上给出 ±0.048 世界单位的位移 ——
 * 缺它时上下文行是完全静止的，与上游的"整屏跟着当前句呼吸"不同。
 *
 * ★ `contextDrift` 的输入是**风格基值 + |lineStepWorld| × 0.030**
 *   （上游 14-stage-lyrics-rendering.js:2396），表里只放风格基值，
 *   调用处补步长那一项。
 * ★ `motionBlend` 是上游的预览混合系数（预览锁定/过渡时 < 1），
 *   本项目没有预览锁定，恒取 1 —— 所以不在式子里出现。
 *
 * 译词行的算法不同（`lyricTranslationAnchoredY`，同文件 :51-73）：
 * 它按**父行**的距离算漂移，且当前译词行同样不漂。
 */
const SOURCE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('上下文行进度漂移 rowDrift（上游 :1599）', () => {
  const body = stripComments(SOURCE)

  it('主行链有 rowDrift 项，且 contextDrift 补了步长那一项', () => {
    // 激活行不漂（上游 motionAnchor ⇒ 0）
    expect(body).toMatch(
      /const rowDrift = isActive\s*\?\s*0\s*:\s*\(0\.5 - shownProgressRef\.current\) \*\s*\(motion\.contextDrift \+ Math\.abs\(LYRIC_LINE_STEP_WORLD\) \* 0\.03\)/,
    )
  })

  it('漂移量乘上游的 clampRange(0.70 + |Δ|×0.10, 0.65, 1.20)', () => {
    expect(body).toMatch(/const driftGain = Math\.max\(0\.65, Math\.min\(1\.2, 0\.7 \+ absDelta \* 0\.1\)\)/)
    // 主行与译词两条链都要有（译词用 parentDelta）
    expect(body).toMatch(
      /const transDriftGain = Math\.max\(0\.65, Math\.min\(1\.2, 0\.7 \+ Math\.abs\(parentDelta\) \* 0\.1\)\)/,
    )
  })

  it('主行 yTarget 带上 rowDrift × driftGain', () => {
    expect(body).toMatch(
      /const yTarget = -liveDelta \* LYRIC_LINE_STEP_WORLD \+ floatY \+ rowDrift \* driftGain/,
    )
  })

  it('主行 z 上补上游的 −|rowDrift| × 0.18（:1606）', () => {
    expect(body).toMatch(/const zTargetWithDrift = zTarget - Math\.abs\(rowDrift\) \* 0\.18/)
    expect(body).toMatch(/mesh\.position\.z \+= \(zTargetWithDrift - mesh\.position\.z\) \* ease/)
  })

  it('不得再让主行 z 直接吃未衰减的 zTarget（漂移项被旁路）', () => {
    expect(body).not.toMatch(/mesh\.position\.z \+= \(zTarget - mesh\.position\.z\) \* ease/)
  })
})

describe('译词行漂移（上游 lyricTranslationAnchoredY :51-73）', () => {
  const body = stripComments(SOURCE)

  it('当前译词行不漂，其余行按 shownProgress 漂', () => {
    expect(body).toMatch(
      /const transRowDrift = isCurrentParent\s*\?\s*0\s*:\s*\(0\.5 - shownProgressRef\.current\) \*\s*\(motion\.contextDrift \+ Math\.abs\(LYRIC_LINE_STEP_WORLD\) \* 0\.03\)/,
    )
  })

  it('译词 yTarget 按父行段加漂移', () => {
    expect(body).toMatch(
      /const yTarget =\s*-parentDelta \* LYRIC_LINE_STEP_WORLD -\s*transSign \* TRANS_GAP \* LYRIC_TRANSLATION_STEP_WORLD \+\s*transRowDrift \* transDriftGain \+\s*floatY/,
    )
  })

  it('译词 z 同时带 −|rowDrift|×0.18 与 +translationFocus×0.065', () => {
    expect(body).toMatch(/const zTargetWithFocus = zTarget - Math\.abs\(transRowDrift\) \* 0\.18 \+ parentFade \* 0\.065/)
  })
})

describe('风格表 contextDrift（上游 08-lyrics-display-modes.js:140-164）', () => {
  const config = readFileSync(join(__dirname, 'lyricDisplayConfig.ts'), 'utf8')

  it('六种风格的 contextDrift 逐条与上游一致', () => {
    // 上游：float 0.120 / smooth 0.030 / shine 0.052 / glitch 0.035 / quick 0.034
    //      （glass 走上游 else 分支 0.066）
    expect(config).toMatch(/contextDrift: 0\.12,/)
    expect(config).toMatch(/contextDrift: 0\.03,/)
    expect(config).toMatch(/contextDrift: 0\.066,/)
    expect(config).toMatch(/contextDrift: 0\.034,/)
    expect(config).toMatch(/contextDrift: 0\.052,/)
    expect(config).toMatch(/contextDrift: 0\.035,/)
  })

  it('LyricMotionProfile 接口里声明了 contextDrift（不是可选的）', () => {
    expect(config).toMatch(/export interface LyricMotionProfile \{[\s\S]*?contextDrift: number\n\}/)
  })

  it('每个 profile 都给了 contextDrift（不得漏某一个）', () => {
    const profileBlock = config.slice(config.indexOf('const MOTION_PROFILES'))
    const styles = ['float', 'smooth', 'glass', 'quick', 'shine', 'glitch']
    for (const style of styles) {
      const start = profileBlock.indexOf(`  ${style}: {`)
      expect(start, `缺少 ${style} 档`).toBeGreaterThan(-1)
      const next = profileBlock.indexOf('  },', start)
      const block = profileBlock.slice(start, next)
      expect(block, `${style} 档缺 contextDrift`).toMatch(/contextDrift: 0\.\d+,/)
    }
  })
})

describe('逐行缩放浮动（上游 :1626，fx.lyricVerticalFloat 出厂 true）', () => {
  const body = stripComments(SOURCE)

  it('主行 scaleTarget 带上错相正弦缩放浮动', () => {
    expect(body).toMatch(
      /const scaleTarget = depthScale \* lyricShelfAvoidScale\(\) \* fitRatio \* floatScaleWobble/,
    )
  })

  it('浮动幅度按风格分 0.012 / 0.004 两档（上游 style===\'float\' 分支）', () => {
    expect(body).toMatch(
      /const floatScaleWobble =\s*\n?\s*1 \+ Math\.sin\(floatPhase\) \* \(motionStyle === 'float' \? 0\.012 : 0\.004\)/,
    )
  })

  it('译词行同样带上（译词行恒非锚定，该项对它总是生效）', () => {
    expect(body).toMatch(
      /depthScale \* lyricShelfAvoidScale\(\) \* \(1 \+ parentFade \* 0\.16\) \* fitRatio \* floatScaleWobble/,
    )
    // 译词的相位与主行 floatY 同源：sin(t*0.68 + slot*0.71)
    expect(body).toMatch(
      /const floatScaleWobble = 1 \+ Math\.sin\(\(nowMs \/ 1000\) \* 0\.68 \+ slot \* 0\.71\) \* \(motionStyle === 'float' \? 0\.012 : 0\.004\)/,
    )
  })

  it('不得把 scaleTarget 写成没有浮动项的裸积', () => {
    expect(body).not.toMatch(/const scaleTarget = depthScale \* lyricShelfAvoidScale\(\) \* fitRatio\n/)
  })
})

describe('uActiveMix / uSolar 残值地板（上游 :1661/:1666-1667）', () => {
  const body = stripComments(SOURCE)

  it('非激活行 uActiveMix < 0.015 直接置 0', () => {
    expect(body).toMatch(
      /if \(!isActive && \(uniforms\.uActiveMix\.value as number\) < 0\.015\) \{\s*\n?\s*uniforms\.uActiveMix\.value = 0\s*\n?\s*\}/,
    )
  })

  it('非激活行 uSolar < 0.003 直接置 0', () => {
    expect(body).toMatch(
      /if \(\(uniforms\.uSolar\.value as number\) < 0\.003\) uniforms\.uSolar\.value = 0/,
    )
  })

  it('译词行的 uActiveMix 也有残值地板（译词行永不激活，恒归零）', () => {
    // 上游 :1661 对所有行生效，不只主行。译词行恒非激活，
    // 少这一步会让译词行残留一丝激活态逐字填充。
    const count = (body.match(/uniforms\.uActiveMix\.value = 0/g) ?? []).length
    expect(count, '主行与译词行两条链都要置零').toBe(2)
  })
})
