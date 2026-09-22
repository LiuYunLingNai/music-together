import { describe, expect, it } from 'vitest'
import { PARTICLE_BLOOM_FRAGMENT_SHADER, PARTICLE_FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './particleVertex'

/**
 * 回归：GLSL 函数**必须先声明后使用**（无前向引用）。
 *
 * ============================ 真实事故 ============================
 *
 * 第二十三轮把 `samplePrevCoverColor` / `mixCoverColor` 两个 helper 插到了
 * 顶点着色器的**顶部 uniform 区**（SIMPLEX_NOISE 展开之前），而它们调用
 * 的 `safeCoverUv` 定义在噪声块之后。GLSL 不做前向声明，于是：
 *
 *   ERROR: 'safeCoverUv' : no matching overloaded function found
 *   ERROR: 'texture2D'    : no matching overloaded function found
 *
 * 顶点着色器编译失败 → `mainMaterial`/`bloomMaterial` 的 program 链接失败
 * → three **静默跳过整个 draw call**（只在控制台留一行警告）：
 * 封面与全部粒子一起消失，而片元着色器本身是好的、typecheck/测试全绿。
 * 用户看到的就是"封面改得消失了"。
 *
 * 上游 `00-pointer-cover-particles.js` 的 helper 顺序是
 *   snoise(:400) → hash11(:430) → safeCoverUv(:434)
 *   → sampleNewCoverColor(:438) → samplePrevCoverColor(:442)
 *   → sampleEdgeColor(:446) → rippleSumAt(:450) → main(:478)
 * 即"被依赖者在前"。本测试把这条约束固化下来。
 */

/** 在着色器源码里找某个函数定义的位置（返回首个定义的起始下标）。 */
function declarationIndex(source: string, name: string): number {
  const re = new RegExp(`\\b(?:float|vec2|vec3|vec4|void)\\s+${name}\\s*\\(`)
  return source.search(re)
}

/**
 * 返回该函数**第一次被调用**的下标（跳过它自己的定义行）。
 *
 * 定义行本身形如 `vec2 safeCoverUv(vec2 uv) {`，因此从定义之后开始找，
 * 再回看定义之前是否已有调用。
 */
function firstCallIndex(source: string, name: string): number {
  const decl = declarationIndex(source, name)
  if (decl < 0) return -1
  const before = source.slice(0, decl)
  const m = before.search(new RegExp(`\\b${name}\\s*\\(`))
  return m
}

describe('粒子顶点着色器：函数声明顺序（GLSL 无前向引用）', () => {
  /** 着色器里全部自定义 helper（顺序即上游顺序）。 */
  const HELPERS = ['snoise', 'hash11', 'safeCoverUv', 'samplePrevCoverColor', 'mixCoverColor', 'rippleSumAt'] as const

  it('每个 helper 都在首次调用之前定义', () => {
    for (const name of HELPERS) {
      const decl = declarationIndex(PARTICLE_VERTEX_SHADER, name)
      expect(decl, `${name} 未定义`).toBeGreaterThan(-1)
      const callBeforeDecl = firstCallIndex(PARTICLE_VERTEX_SHADER, name)
      expect(
        callBeforeDecl,
        `${name} 在定义之前被调用（GLSL 不支持前向引用，会导致整个顶点着色器编译失败、封面与粒子全部消失）`,
      ).toBe(-1)
    }
  })

  it('safeCoverUv 定义在调用它的 helper 之前（第二十三轮事故的直接回归）', () => {
    const safe = declarationIndex(PARTICLE_VERTEX_SHADER, 'safeCoverUv')
    const prev = declarationIndex(PARTICLE_VERTEX_SHADER, 'samplePrevCoverColor')
    const mix = declarationIndex(PARTICLE_VERTEX_SHADER, 'mixCoverColor')
    expect(safe).toBeGreaterThan(-1)
    expect(prev).toBeGreaterThan(-1)
    expect(mix).toBeGreaterThan(-1)
    // 被依赖者在前 —— 上游 00-pointer-cover-particles.js:434/442/446 同序
    expect(safe).toBeLessThan(prev)
    expect(prev).toBeLessThan(mix)
  })

  it('safeCoverUv 定义在 SIMPLEX_NOISE 之后（不能插进顶部 uniform 区）', () => {
    // 事故的另一种写法：把 helper 放到噪声块之前。这里断言 safeCoverUv
    // 必须出现在噪声块之后，与上游 00-pointer-cover-particles.js 一致。
    const safe = declarationIndex(PARTICLE_VERTEX_SHADER, 'safeCoverUv')
    const noise = declarationIndex(PARTICLE_VERTEX_SHADER, 'snoise')
    expect(noise).toBeGreaterThan(-1)
    expect(safe).toBeGreaterThan(noise)
  })

  it('main 之前所有 helper 都已定义', () => {
    const mainIdx = PARTICLE_VERTEX_SHADER.search(/void\s+main\s*\(\s*\)/)
    expect(mainIdx).toBeGreaterThan(-1)
    for (const name of HELPERS) {
      expect(declarationIndex(PARTICLE_VERTEX_SHADER, name)).toBeLessThan(mainIdx)
    }
  })

  it('片元着色器不引用顶点专属 helper（片元是独立编译单元）', () => {
    // 顶点里定义的 helper 对片元不可见。片元一旦引用就会编译失败，
    // 同样导致整个 program 链接失败、draw call 被静默跳过。
    for (const src of [PARTICLE_FRAGMENT_SHADER, PARTICLE_BLOOM_FRAGMENT_SHADER]) {
      for (const name of ['safeCoverUv', 'samplePrevCoverColor', 'mixCoverColor', 'rippleSumAt', 'snoise']) {
        expect(src, `片元引用了顶点专属 helper ${name}`).not.toMatch(new RegExp(`\\b${name}\\s*\\(`))
      }
    }
  })
})
