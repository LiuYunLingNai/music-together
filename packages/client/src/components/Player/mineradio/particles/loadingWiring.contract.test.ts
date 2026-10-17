import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：加载态雾环的**接线**（上游 `uLoading` 的驱动链）。
 *
 * ============================ 为什么需要 ============================
 *
 * 算术本身由 `loadingState.test.ts` 钉住。这里钉的是另一类、也更容易犯的错：
 * **链路断了但没人发现**。着色器那段雾状微尘流是逐行对齐的，却因为
 * `uniforms.uLoading.value` 没有任何写入方而做了整整几轮死代码。
 *
 * 这条链有四段，任何一段缺失都会退回死代码：
 *
 *   useHowl（知道何时在缓冲）
 *     → showLoading() / hideLoading()
 *       → loadingState 单例
 *         → ParticleField 的 useFrame 调 stepLoading()
 *           → uniforms.uLoading.value
 *             → 顶点着色器 if (uLoading > 0.001)
 *
 * 用源码结构断言而非运行时验证：`useHowl` / `ParticleField` 都依赖
 * three.js 与 Howler，在 node 环境里跑不起来；而"是否调用"这件事
 * 本来就能从静态结构上看出来。
 */

const HERE = __dirname

const USE_HOWL = readFileSync(join(HERE, '../../../../hooks/useHowl.ts'), 'utf8')
const PARTICLE_FIELD = readFileSync(join(HERE, 'ParticleField.tsx'), 'utf8')
const VERTEX_SHADER = readFileSync(join(HERE, 'shaders/particleVertex.ts'), 'utf8')

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('uLoading 驱动链', () => {
  const howl = stripComments(USE_HOWL)
  const field = stripComments(PARTICLE_FIELD)
  const shader = stripComments(VERTEX_SHADER)

  it('① useHowl 真的 import 了 showLoading / hideLoading', () => {
    expect(howl).toMatch(/import\s*\{[^}]*\bshowLoading\b[^}]*\}\s*from\s*'[^']*loadingState'/)
    expect(howl).toMatch(/import\s*\{[^}]*\bhideLoading\b[^}]*\}\s*from\s*'[^']*loadingState'/)
  })

  it('① 缓冲区间起点调用 showLoading（且在没有流地址的早退之后）', () => {
    // `if (!track.streamUrl) return` 之后才点亮 —— 否则永远不会撤
    const earlyReturn = howl.indexOf('if (!track.streamUrl) return')
    const show = howl.indexOf('showLoading()')
    expect(earlyReturn).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(earlyReturn)
  })

  it('① 每一条"放弃/完成"路径都撤掉加载态', () => {
    // onload（内容可取）
    expect(howl).toMatch(/onload:[\s\S]{0,900}hideLoading\(\)/)
    // onplay（真正开播）
    expect(howl).toMatch(/onplay:[\s\S]{0,400}hideLoading\(\)/)
    // 加载失败（重试之后）
    expect(howl).toMatch(/onloaderror:[\s\S]{0,1400}hideLoading\(\)/)
    // 加载超时
    expect(howl).toMatch(/loadTimerRef\.current = setTimeout\([\s\S]{0,700}hideLoading\(\)/)
    // 停播
    expect(howl).toMatch(/stopTimeUpdate\(\)\s*\n\s*hideLoading\(\)/)
  })

  it('① 重试分支**不**撤（那次 howl.load() 仍可能成功）', () => {
    // 重试分支必须在 hideLoading 之前 return，否则雾环会在重试期间就退场
    const retryBranch = howl.indexOf("console.warn('Howl load error, retrying:', msg)")
    expect(retryBranch).toBeGreaterThan(-1)
    const hideAfterRetry = howl.indexOf('hideLoading()', retryBranch)
    const retryReturn = howl.indexOf('return', retryBranch)
    expect(retryReturn).toBeGreaterThan(retryBranch)
    expect(retryReturn).toBeLessThan(hideAfterRetry)
  })

  it('② ParticleField 的帧循环调 stepLoading 并写进 uniform', () => {
    expect(field).toMatch(/import\s*\{[^}]*\bstepLoading\b[^}]*\}\s*from\s*'\.\/loadingState'/)
    // 写入必须落在 useFrame 里
    expect(field).toMatch(/u\.uLoading\.value = stepLoading\(performance\.now\(\)\)/)
  })

  it('② uniform 本身已声明（缺了它着色器编译不过，但值永远没人写）', () => {
    expect(field).toMatch(/uLoading:\s*\{\s*value:\s*0\s*\}/)
  })

  it('③ 卸载时复位（单例不得跨挂载残留）', () => {
    expect(field).toMatch(/useEffect\(\(\) => resetLoadingState,\s*\[\]\)/)
  })

  it('④ 着色器真的读 uLoading（不是只声明）', () => {
    // 上游的雾状微尘流整段都在 `if (uLoading > 0.001)` 里
    expect(shader).toMatch(/if \(uLoading > 0\.001\)/)
    // 五项混合缺一不可：位置 / 颜色 / 亮度 / 透明度 / 点尺寸
    expect(shader).toMatch(/pos = mix\(pos, mistPos, uLoading\)/)
    expect(shader).toMatch(/vColor = mix\(vColor, mistCol, uLoading \* 0\.78\)/)
    expect(shader).toMatch(/vBright = mix\(vBright,/)
    expect(shader).toMatch(/vAlpha = mix\(vAlpha,/)
    expect(shader).toMatch(/sz = mix\(sz, sz \* loadingMistSize, uLoading\)/)
  })

  it('④ 着色器把 uLoading 声明为 uniform（而不是用字面量替代）', () => {
    expect(shader).toMatch(/uniform float uMouseActive, uPixel, uColorMixT, uLoading;/)
    // 泛光变体同样要带上它（上游 :1016 的 replace 同款处理）
    expect(shader).toMatch(
      /uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;/,
    )
  })
})

describe('封面深度补间接线（上游 setCoverDepthState）', () => {
  const field2 = stripComments(readFileSync(join(HERE, 'ParticleField.tsx'), 'utf8'))

  it('① 帧循环里 uHasDepth 与 uAiBoost 成对推进（不得只补间一个）', () => {
    // 上游是同一个 rAF 回调里的两行（:505）；本项目是同一次 stepCoverDepth 的两个写入
    expect(field2).toMatch(/u\.uHasDepth\.value = stepped\.depth/)
    expect(field2).toMatch(/u\.uAiBoost\.value = stepped\.ai/)
    // 且都发生在 `if (depthTween.target)` 分支内（顺序上相邻）
    const depthAt = field2.indexOf('u.uHasDepth.value = stepped.depth')
    const aiAt = field2.indexOf('u.uAiBoost.value = stepped.ai')
    expect(depthAt).toBeGreaterThan(-1)
    expect(aiAt).toBeGreaterThan(depthAt)
  })

  it('② effect 里调用 beginCoverDepthTween，且处理硬落位返回值', () => {
    expect(field2).toMatch(/beginCoverDepthTween\(/)
    // 返回 false 时必须立刻写目标值，否则补间没装配、值也没变 —— 深度就丢了。
    // 中间允许插注释（源码里那段注释很长），因此只约束"紧邻"。
    expect(field2).toMatch(/if \(!armed\) \{\s*\n\s*uniforms\.uHasDepth\.value = edgeTexture \? 1 : 0/)
  })

  it('② 有边缘纹理走"重算完成"档 180ms；没有走 1ms 硬落位', () => {
    expect(field2).toMatch(/edgeTexture \? COVER_DEPTH_TWEEN_MS\.recomputed : COVER_DEPTH_TWEEN_MS\.neutral/)
  })

  it('③ 不得再把 uHasDepth 写成无条件瞬变（曾经的偏差）', () => {
    // `uniforms.uHasDepth.value = edgeTexture ? 1 : 0` 只允许出现在
    // `if (!armed)` 硬落位分支里，不得再作为唯一写入点。
    const snaps = (field2.match(/uniforms\.uHasDepth\.value = edgeTexture \? 1 : 0/g) ?? []).length
    expect(snaps).toBe(1)
  })

  it('④ 常量与上游四个调用点一致', () => {
    const tween = stripComments(readFileSync(join(HERE, 'coverDepthTween.ts'), 'utf8'))
    expect(tween).toMatch(/aiEnhanced:\s*360/)
    expect(tween).toMatch(/cached:\s*120/)
    expect(tween).toMatch(/neutral:\s*1/)
    expect(tween).toMatch(/recomputed:\s*180/)
    expect(tween).toMatch(/DEPTH_SETTLED_EPSILON = 0\.001/)
  })
})
