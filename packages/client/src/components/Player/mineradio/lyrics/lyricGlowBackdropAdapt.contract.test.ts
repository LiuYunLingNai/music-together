import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：辉光层的 **backdropAdapt 压暗项**与**译词辉光双分支**
 * （上游 `02-visual/12-lyrics-row-layers.js:1718-1729`）。
 *
 * ============================ 曾经的偏差 ============================
 *
 * 上游辉光透明度目标值的完整公式：
 *
 *   var glowOpacityTarget = isActive
 *     ? target * rowGlow * (1 + rowGlowBeat * 0.46) * depthFade
 *     : (row.isTranslation
 *         ? target * rowGlow * (currentTranslation
 *             ? (0.46 + rowGlowBeat * 0.08)
 *             : (0.30 + rowGlowBeat * 0.06) * translationGlowFocus) * depthFade
 *         : 0);
 *   if (backdropAdapt > 0.001) glowOpacityTarget *= (1 - backdropAdapt * 0.30);
 *
 * 本项目此前只把 `BACKDROP_ADAPT`（亮底避光，出厂 0.72）用在**可读性描边层**，
 * 辉光层一处都没用。后果：
 *
 *   ① 亮封面下辉光**不会像上游那样压暗**。"亮底避光"机制只做了一半 ——
 *      描边变重了，辉光依旧满亮度，等于在亮底上又叠一层亮，文字反而更糊。
 *   ② 译词辉光只有"当前父行"一个分支（0.46 基准），
 *      **非当前父行的译词辉光恒为 0**。上游在 `multi`（出厂默认译词模式）
 *      下上下文译词是有辉光的（0.30 基准 × translationGlowFocus），
 *      于是同一次副歌里"当前那句的译文发光、上一句的译文不发光"，
 *      明暗断层比上游明显。
 *   ③ 译词辉光漏了 `rowGlowBeat` 项（上游两分支都带节拍泛光）。
 *
 * 本测试从源码结构钉住这三项。
 */
const SOURCE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('辉光 backdropAdapt 压暗（上游 :1722）', () => {
  const body = stripComments(SOURCE)

  it('主行辉光链带 (1 − BACKDROP_ADAPT×0.30) 压暗项', () => {
    // 上游那一行是**无条件**乘（只要 adapt > 0.001），因此必须是
    // 目标值表达式的一部分，而不是只在某个 if 分支里乘。
    // 基准是 `target`（= opacity × contextAlpha × rowIntro × visibleFade），
    // 不是条目的上下文 α —— 上游 :1720 的 `target * rowGlow * …`。
    expect(body).toMatch(
      /targetOpacity \* currentLineGlow \* \(1 \+ rowGlowBeat \* 0\.46\) \* depthFade \* backdropAdaptDim/,
    )
  })

  it('译词辉光链同样带压暗项（两个分支都要）', () => {
    // 上游对 isTranslation 的非激活支与激活支是同一个 `if` 之后的乘法，
    // 两条路径都受影响。
    // ★ 基准是 `glowBase`（= opacity × contextAlpha × rowIntro × visibleFade），
    //   且 `translationFocus` 只乘非当前支（当前支的 0.46 已是焦点满值）。
    expect(body).toMatch(
      /glowBase \* currentLineGlow \* \(0\.46 \+ rowGlowBeat \* 0\.08\) \* depthFade \* backdropAdaptDim/,
    )
    expect(body).toMatch(
      /glowBase \* currentLineGlow \* \(0\.3 \+ rowGlowBeat \* 0\.06\) \* parentFade \* depthFade \* backdropAdaptDim/,
    )
  })

  it('压暗项由同一个常量算出（不得在各处写死近似值）', () => {
    const dims = (body.match(/1 - BACKDROP_ADAPT \* 0\.3/g) ?? []).length
    // 定义两处（主行链 + 译词链），每处一次；写成 0.784 / 0.7840 之类字面量即失败
    expect(dims, 'backdropAdaptDim 必须在两条链里各算一次').toBe(2)
    // 不得把结果写死（0.72 × 0.30 = 0.216 → 1 − 0.216 = 0.784）。
    // 只查**辉光目标表达式附近**：文件别处合法地用到了 0.78
    // （LYRIC_TRANSLATION_STEP_WORLD 的夹区上界、可读性 boost 的 0.78）。
    const glowExprs = body.match(/glowOpacityTarget[\s\S]{0,320}?depthFade \* [^;]*;/g) ?? []
    expect(glowExprs.length, '应能取到辉光目标表达式').toBeGreaterThanOrEqual(2)
    for (const expr of glowExprs) {
      expect(expr).not.toMatch(/\* 0\.7[0-9]/)
    }
  })
})

describe('译词辉光双分支（上游 :1721）', () => {
  const body = stripComments(SOURCE)

  it('当前父行：0.46 + rowGlowBeat×0.08（上游 currentTranslation 支）', () => {
    // 此前是裸 0.46 —— 漏了 rowGlowBeat 项
    expect(body).toMatch(/\(0\.46 \+ rowGlowBeat \* 0\.08\)/)
  })

  it('非当前父行：0.30 + rowGlowBeat×0.06，再乘 translationGlowFocus', () => {
    // 此前整支是 0（`isCurrentParent ? … : 0`）—— 上下文译词永无辉光
    expect(body).toMatch(/\(0\.3 \+ rowGlowBeat \* 0\.06\) \* parentFade/)
  })

  it('不得再把非当前译词辉光写成常量 0', () => {
    // 曾经的写法：`const glowOpacityTarget = isCurrentParent ? … : 0`
    expect(body).not.toMatch(/glowOpacityTarget = isCurrentParent[\s\S]{0,200}: 0\b/)
  })

  it('rowGlowBeat 夹取区间与上游一致（0 … 1.5）', () => {
    // 上游 :1433 `clampRange(Number(opts.rowGlowBeat) || 0, 0, 1.5)`
    expect(body).toMatch(/Math\.max\(0, Math\.min\(1\.5, glowStateRef\.current\.beatGlow\)/)
  })
})

describe('译词可读性 mix 的 backdropAdapt 下界（上游 :1684-1687）', () => {
  const body = stripComments(SOURCE)

  it('译词 mix 走 max(mix, 0.54 + adapt×0.10)（上游 translation 支）', () => {
    // 上游：
    //   readabilityMix = row.isTranslation ? (0.46 + translationFocus * 0.18) : …
    //   if (backdropAdapt > 0.001) readabilityMix = Math.max(readabilityMix,
    //     row.isTranslation ? (0.54 + backdropAdapt * 0.10) : (0.60 + backdropAdapt * 0.12));
    expect(body).toMatch(/Math\.max\(0\.46 \+ parentFade \* 0\.18, 0\.54 \+ BACKDROP_ADAPT \* 0\.1\)/)
  })

  it('focus 项用**连续** parentFade，不是布尔 isCurrentParent', () => {
    // 上游 translationFocus 是 0..1 连续值（parentFade 的 smoothstep），
    // 不是二值。此前写成 `isCurrentParent ? 0.18 : 0` —— dual 模式下
    // 下一行译词的 focus 是 0.56，会掉到布尔 false 分支，mix 少了 0.10。
    expect(body).not.toMatch(/0\.46 \+ \(isCurrentParent \? 0\.18 : 0\)/)
  })
})
