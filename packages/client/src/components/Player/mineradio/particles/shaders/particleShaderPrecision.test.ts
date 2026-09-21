import { describe, expect, it } from 'vitest'
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
} from './particleVertex'

/**
 * 回归测试：着色器精度与 uniform 契约。
 *
 * 重写为严格对齐 OpenMusic `galaxy/lib/visualVertexShader.ts` + `lib/shaders.ts`
 * 之后，**顶点着色器也显式声明 `precision highp float`**（上游第 3 行），
 * 因此两侧精度一致，从根本上消除了此前的事故：
 *
 *   THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
 *   Precisions of uniform 'uBeat' differ between VERTEX and FRAGMENT shaders.
 *   WebGL: INVALID_OPERATION: useProgram: program not valid
 *
 * 该事故会让整个粒子程序无法绘制 —— 舞台一个像素都不显示。
 */

/**
 * 取出着色器里声明的 uniform 名（含数组）。
 *
 * 注意上游是**逗号分隔的批量声明**风格（照搬自 visualVertexShader.ts）：
 *   uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
 * 因此不能只匹配「一行一个」。这里按行取 `uniform <type> <列表>`，
 * 再按逗号拆分，并去掉数组下标。
 */
function declaredUniforms(src: string): string[] {
  const names: string[] = []
  const lineRe = /^\s*uniform\s+\w+\s+([^;]+);/gm
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      // 去掉数组下标：uRipples[10] -> uRipples
      const name = raw.trim().replace(/\[.*$/, '').trim()
      if (name) names.push(name)
    }
  }
  return names
}

describe('粒子着色器精度', () => {
  it('顶点着色器显式声明 highp（与上游一致）', () => {
    expect(PARTICLE_VERTEX_SHADER).toMatch(/precision\s+highp\s+float/)
  })

  it('主粒子片元着色器声明 highp', () => {
    expect(PARTICLE_FRAGMENT_SHADER).toMatch(/precision\s+highp\s+float/)
  })

  it('泛光片元着色器声明 highp', () => {
    expect(PARTICLE_BLOOM_FRAGMENT_SHADER).toMatch(/precision\s+highp\s+float/)
  })

  it('三个着色器都不使用 mediump（共享 uniform 精度必须一致）', () => {
    for (const src of [
      PARTICLE_VERTEX_SHADER,
      PARTICLE_FRAGMENT_SHADER,
      PARTICLE_BLOOM_FRAGMENT_SHADER,
    ]) {
      expect(src).not.toMatch(/precision\s+mediump/)
      expect(src).not.toMatch(/precision\s+lowp/)
    }
  })

  it('没有任何 uniform 带 per-declaration 精度限定符', () => {
    // 形如 `uniform highp float uBeat;` 会与另一侧的默认精度不一致
    const perDecl = /uniform\s+(lowp|mediump|highp)\s/
    expect(PARTICLE_VERTEX_SHADER).not.toMatch(perDecl)
    expect(PARTICLE_FRAGMENT_SHADER).not.toMatch(perDecl)
    expect(PARTICLE_BLOOM_FRAGMENT_SHADER).not.toMatch(perDecl)
  })
})

describe('跨阶段共享 uniform', () => {
  it('主片元与顶点共享的 uniform 集合稳定（改动需同步检查精度声明）', () => {
    const vs = new Set(declaredUniforms(PARTICLE_VERTEX_SHADER))
    const sharedWithMain = declaredUniforms(PARTICLE_FRAGMENT_SHADER)
      .filter((u) => vs.has(u))
      .sort()
    // 打印实际值便于诊断（断言失败时能看到真实集合）
    expect(sharedWithMain).toEqual(['uPreset'])
  })

  it('uAlpha / uParticleDim 仅由片元声明，因此不存在跨阶段精度冲突', () => {
    // 这是刻意的设计：亮度乘数只作用于片元阶段。
    const vs = new Set(declaredUniforms(PARTICLE_VERTEX_SHADER))
    expect(vs.has('uAlpha')).toBe(false)
    expect(vs.has('uParticleDim')).toBe(false)

    expect(declaredUniforms(PARTICLE_FRAGMENT_SHADER)).toContain('uAlpha')
    expect(declaredUniforms(PARTICLE_FRAGMENT_SHADER)).toContain('uParticleDim')
  })
})

describe('亮度链路（真实事故：画面 maxV=36，几乎全黑）', () => {
  it('片元着色器必须包含 uAlpha 全局淡入乘数', () => {
    // 上游：tex.a * uAlpha * uParticleDim * vAlpha
    // 缺失 uAlpha 会让整体亮度永久停在基线，画面几乎不可见。
    expect(PARTICLE_FRAGMENT_SHADER).toMatch(/tex\.a\s*\*\s*uAlpha/)
    expect(PARTICLE_BLOOM_FRAGMENT_SHADER).toMatch(/uAlpha/)
  })

  it('顶点着色器必须在预设分叉前把 vAlpha 基准设为 1.0', () => {
    // 上游第 132 行：vAlpha = 1.0;
    // 此前每个预设都自行压低 alpha，是画面发暗的主因之一。
    expect(PARTICLE_VERTEX_SHADER).toMatch(/vAlpha\s*=\s*1\.0\s*;/)

    const baseIdx = PARTICLE_VERTEX_SHADER.indexOf('vAlpha = 1.0')
    const firstPresetIdx = PARTICLE_VERTEX_SHADER.indexOf('Preset 0')
    expect(baseIdx).toBeGreaterThan(-1)
    expect(firstPresetIdx).toBeGreaterThan(-1)
    // 基准赋值必须出现在预设分叉之前
    expect(baseIdx).toBeLessThan(firstPresetIdx)
  })

  it('点尺寸公式与上游一致：36.0 / max(0.5, -mv.z)，clamp 1.05..4.95', () => {
    expect(PARTICLE_VERTEX_SHADER).toMatch(/36\.0\s*\/\s*max\(0\.5,\s*-mvPos\.z\)/)
    expect(PARTICLE_VERTEX_SHADER).toMatch(/clamp\(depthSize\s*\*\s*audioBoost,\s*1\.05,\s*4\.95\)/)
    expect(PARTICLE_VERTEX_SHADER).toMatch(/gl_PointSize\s*=\s*sz\s*\*\s*uPixel\s*\*\s*uPointScale/)
  })
})

describe('泛光顶点着色器派生', () => {
  it('由主顶点着色器派生，只是额外乘 uBloomSize', () => {
    expect(PARTICLE_BLOOM_VERTEX_SHADER).toContain('uBloomSize')
    expect(PARTICLE_BLOOM_VERTEX_SHADER).toMatch(
      /gl_PointSize\s*=\s*sz\s*\*\s*uPixel\s*\*\s*uPointScale\s*\*\s*uBloomSize/,
    )
  })

  it('派生后仍保留精度声明', () => {
    expect(PARTICLE_BLOOM_VERTEX_SHADER).toMatch(/precision\s+highp\s+float/)
  })
})

describe('六个预设槽位齐全', () => {
  it('包含全部 6 个预设分支（0-5）', () => {
    for (const marker of [
      'Preset 0',
      'Preset 1',
      'Preset 2',
      'Preset 3',
      'Preset 4',
      'Preset 5',
    ]) {
      expect(PARTICLE_VERTEX_SHADER).toContain(marker)
    }
  })

  it('预设判定用 uPreset 的 0.5 半整数阈值（与上游一致）', () => {
    for (const v of ['0.5', '1.5', '2.5', '3.5', '4.5']) {
      expect(PARTICLE_VERTEX_SHADER).toContain(`uPreset < ${v}`)
    }
  })
})
