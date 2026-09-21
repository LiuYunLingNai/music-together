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
   *
   * 第二十九轮补充：守卫条件由 `wiredKind === 'masterGain'` 收紧为
   * `analyser && wiredKind === 'masterGain'`（为了删掉开头的提前返回，
   * 见下一条用例）。**不变量不变**：disconnect 只能在 masterGain 分支内。
   */
  it('disposeAudioAnalyser 只拆自建的兜底节点，不碰共享 tap', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))
    // 截取 dispose 函数体
    const fnIdx = source.indexOf('export function disposeAudioAnalyser')
    expect(fnIdx).toBeGreaterThan(-1)
    const body = source.slice(fnIdx, source.indexOf('\n}', fnIdx))
    // disconnect 必须被 masterGain 守卫保护，
    // 且只出现 masterGain 摘除 + 自建节点断开这两处（tap 绝不被拆）
    const guardMatch = body.match(/if\s*\(([^)]*)\)\s*\{/)
    expect(guardMatch, 'dispose 函数体应以守卫分支开头').toBeTruthy()
    expect(guardMatch![1]).toMatch(/wiredKind\s*===\s*'masterGain'/)
    expect(body.match(/\.disconnect/g)?.length).toBe(2)
    // 守卫分支必须先于 disconnect 出现
    const guard = body.indexOf("wiredKind === 'masterGain'")
    const disconnect = body.indexOf('.disconnect')
    expect(disconnect).toBeGreaterThan(guard)
  })

  /**
   * 第二十九轮回归：`failed` 闩锁必须可恢复，且**不得**门控 tap 路径。
   *
   * ============================ 真实事故 ============================
   *
   * 用户反馈：「从原生播放器切到 mineradio 就会丢失节拍反馈」、
   *          「浏览器较长时间在后台，再回到浏览器也会丢失」。
   *
   * 两个独立缺陷叠在一起：
   *
   *   1. `disposeAudioAnalyser()` 以 `if (!analyser) return` 开头。而
   *      `analyser === null` 是**常见状态**（挂载瞬间 / tap 未发布 /
   *      切歌过渡 / 上一次 dispose 之后）。提前返回让 `failed = false`
   *      这行永远执行不到 —— 闩锁再也清不掉，只能刷新页面。
   *
   *   2. `ensureAudioAnalyser()` 以 `if (failed) return false` 开头，而
   *      `failed` 的置位判据属于**兜底路径**（Howler 有 ctx 却没 masterGain、
   *      或 createAnalyser 抛错）。tap 这条唯一有音频的线路根本不需要
   *      ctx/masterGain，却被这个总闸一起挡掉。
   *
   * 本用例静态钉住修正后的结构：tap 分支在 failed 检查之前，且 failed
   * 只出现在兜底路径里。
   */
  it('failed 闩锁不得门控 tap 路径，且 dispose 必须能清掉它', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))

    // ---- dispose：不得提前返回，且必须复位 failed ----
    const disposeIdx = source.indexOf('export function disposeAudioAnalyser')
    const disposeBody = source.slice(disposeIdx, source.indexOf('\n}', disposeIdx))
    expect(disposeBody, 'dispose 不得以 if (!analyser) return 提前返回').not.toMatch(
      /^\s*if\s*\(\s*!analyser\s*\)\s*return/,
    )
    expect(disposeBody).toMatch(/failed\s*=\s*false/)
    // 切换经典/视觉舞台只是 UI 生命周期，不是音频源切换；这里清空自适应
    // 状态会让每次回来都重新经历 90 帧阈值学习。
    expect(disposeBody).not.toMatch(/resetSonicAudioMonitor\s*\(/)
    expect(disposeBody).not.toMatch(/cached\s*=\s*null/)

    // ---- ensure：tap 分支必须先于 failed 检查 ----
    const ensureIdx = source.indexOf('export function ensureAudioAnalyser')
    const ensureBody = source.slice(ensureIdx, source.indexOf('\n}\n', ensureIdx))

    const tapAt = ensureBody.indexOf('getAudioTapAnalyser()')
    const failedAt = ensureBody.indexOf('if (failed)')
    expect(tapAt, 'tap 读取未找到').toBeGreaterThan(-1)
    expect(failedAt, 'failed 检查未找到').toBeGreaterThan(-1)
    expect(tapAt, 'tap 必须早于 failed 检查（否则兜底失败会挡掉唯一有音频的线路）').toBeLessThan(failedAt)

    // 函数开头不得再有 failed 总闸
    const firstStatement = ensureBody.slice(ensureBody.indexOf('{') + 1).trimStart()
    expect(firstStatement.startsWith('if (failed)')).toBe(false)

    // tap 命中时顺手清闩锁
    expect(ensureBody).toMatch(/failed\s*=\s*false/)
  })

  it('真实音频源切换按 tap 发布代次重置，舞台重挂载不误重置', () => {
    const source = stripComments(readFileSync(join(MINERADIO_DIR, 'shared', 'AudioAnalyser.ts'), 'utf8'))
    const ensureIdx = source.indexOf('export function ensureAudioAnalyser')
    const ensureBody = source.slice(ensureIdx, source.indexOf('\n}\n', ensureIdx))
    expect(ensureBody).toMatch(/getAudioTapRevision\s*\(/)
    expect(ensureBody).toMatch(/nextTapRevision\s*!==\s*tapRevision/)
    expect(ensureBody).toMatch(/resetSonicAudioMonitor\s*\(\)/)
    expect(ensureBody).toMatch(/tapRevision\s*=\s*nextTapRevision/)
  })
})
