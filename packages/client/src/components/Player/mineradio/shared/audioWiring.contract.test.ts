import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：音频接线不能只挂在「粒子模式才挂载」的组件上。
 *
 * 真实事故：`ensureAudioAnalyser()` 原先只在 `ParticleField` 的 effect 里调用，
 * 而「声波地形」模式下 `ParticleField` 根本不挂载（与地形互斥）。
 * 结果地形模式下分析节点从未接线 → `stepAudioFrame` 直接 return →
 * `getSonicAudioFrame()` 恒为 null → **地形完全没有鼓点反应**。
 *
 * 这个测试不跑运行时，只做静态检查：读源码，断言
 * `ensureAudioAnalyser()` 的调用点**不在** `ParticleField.tsx` 里。
 * 一旦有人把接线挪回去，测试立刻失败。
 */
const MINERADIO_DIR = join(__dirname, '..')

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

/** 去掉注释，避免把说明文字里的函数名也算成调用。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('音频接线契约', () => {
  const files = collectSourceFiles(MINERADIO_DIR)

  it('ensureAudioAnalyser() 的调用点不在只随粒子模式挂载的组件里', () => {
    const offenders = files.filter((file) => {
      // 定义处不算
      if (file.endsWith('AudioAnalyser.ts')) return false
      const source = stripComments(readFileSync(file, 'utf8'))
      return /ensureAudioAnalyser\s*\(/.test(source)
    })
    const particleField = offenders.find((f) => f.endsWith('ParticleField.tsx'))
    expect(particleField, '接线不能放在 ParticleField —— 地形模式下它不挂载').toBeUndefined()
    // 必须至少有一个调用点（否则等于没接线）
    expect(offenders.length).toBeGreaterThan(0)
  })

  it('接线点落在与模式无关的 AudioStepDriver 所在的文件里', () => {
    const scene = files.find((f) => f.endsWith('ParticleScene.tsx'))
    expect(scene).toBeDefined()
    const source = stripComments(readFileSync(scene!, 'utf8'))
    expect(source).toMatch(/ensureAudioAnalyser\s*\(/)
  })

  it('readAudioBands 不再接受参数（消费者只能读缓存）', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))
    expect(source).toMatch(/export function readAudioBands\s*\(\s*\)/)
  })

  /**
   * 第九轮回归：tap 优先级必须**逐帧**生效，不能被 `if (wired) return` 短路。
   *
   * 真实事故：`ensureAudioAnalyser` 原先在已接线时直接 return true，于是
   * masterGain 兜底（或旧歌的 tap）一经建立就永久霸占接线 —— 而兜底线是
   * 没有音频流过的静默线，切歌后新 tap 也无法接管，表现为"没有鼓点"。
   */
  it('ensureAudioAnalyser 在 tap 发布后必须从兜底升级（不得被接线状态短路）', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))
    // tap 读取必须发生在任何"已接线直接返回"之前：函数内不允许出现
    // 顶部短路（`if (wired) return true`）——接线状态只能记录来源，不能拦住 tap 检查。
    expect(source).not.toMatch(/if\s*\(\s*wired\s*\)\s*return\s+true/)
    // 仍需显式比较 analyser 与 tap，避免每帧重建
    expect(source).toMatch(/analyser\s*!==\s*tapped/)
  })

  /**
   * 第九轮回归：tap 由 `timeStretch` 拥有，舞台卸载时**不得** disconnect 它。
   *
   * 真实事故：`disposeAudioAnalyser` 原先无条件 `analyser.disconnect()`，
   * 把共享 tap 从 worklet 上拆掉 —— 重新进入舞台时接到的是死节点。
   */
  it('disposeAudioAnalyser 只拆自建的兜底节点，不碰共享 tap', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))
    // 截取 dispose 函数体
    const fnIdx = source.indexOf('export function disposeAudioAnalyser')
    expect(fnIdx).toBeGreaterThan(-1)
    const body = source.slice(fnIdx, source.indexOf('\n}', fnIdx))
    // disconnect 必须被 wiredKind === 'masterGain' 分支保护，
    // 且只出现 masterGain 摘除 + 自建节点断开这两处（tap 绝不被拆）
    expect(body).toMatch(/if\s*\(\s*wiredKind\s*===\s*'masterGain'\s*\)/)
    expect(body.match(/\.disconnect/g)?.length).toBe(2)
    // 守卫分支必须先于 disconnect 出现
    const guard = body.indexOf("wiredKind === 'masterGain'")
    const disconnect = body.indexOf('.disconnect')
    expect(disconnect).toBeGreaterThan(guard)
  })
})
