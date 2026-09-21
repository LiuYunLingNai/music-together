import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 第十六轮回归：歌词常驻轨道与激活门控的结构性约束。
 *
 * 真实事故：逐行分层首版只在**构建时刻**建 activeIndex±3.5 的行、之后永不
 * 补充 —— 播放推进后新行从未被建出，表现为"歌词只显示刚进入时的前后三句"；
 * 同时激活窗口/透明度被冻结在构建时刻、栅格给所有行涂 R=255，
 * 表现为"激活行高亮永远不会消失"。
 *
 * 这些错误都源于"把运行时状态当成了构建时状态"。本测试不跑运行时，
 * 只做静态检查：读源码，断言关键结构存在。
 */
const LYRIC_STAGE = readFileSync(
  join(__dirname, 'LyricStage.tsx'),
  'utf8',
)
const LYRIC_SHADERS = readFileSync(
  join(__dirname, 'lyricShaders.ts'),
  'utf8',
)

/** 去掉注释，避免把说明文字里的代码也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('歌词常驻轨道与激活门控契约', () => {
  it('行槽位必须覆盖整首歌（常驻轨道）+ 译词独立行，懒建在 useFrame 里补齐', () => {
    const source = stripComments(LYRIC_STAGE)
    // 槽位 = 主行数 + 译词独立行数（上游 translationLine 语义：
    // 译词是独立网格/虚拟槽位，不与主行同纹理 —— 内嵌小字会导致重叠）
    expect(source).toMatch(/rowsRef\.current\s*=\s*new Array\(/)
    expect(source).toMatch(/transSlot\.reduce/)
    // 译词行挂主行区后半段
    expect(source).toMatch(/lines\.length\s*\+\s*\(slotInfo\.transOffset/)
    // 懒建调用发生在 useFrame 内（buildRow 出现在每帧循环附近）
    expect(source).toMatch(/row\s*=\s*buildRow\(lineIndex/)
  })

  it('激活态逐帧重判，不再冻结在构建时刻', () => {
    const source = stripComments(LYRIC_STAGE)
    // isActive 每帧按行索引与激活行比较（而不是读构建时字段）
    expect(source).toMatch(/const isActive\s*=\s*lineIndex\s*===\s*active/)
    // uActiveMix 逐帧缓动
    expect(source).toMatch(/uActiveMix/)
  })

  it('rebuildRowAsActive 不得改写 targetAlpha（上下文亮度统一性）', () => {
    // 真实事故（第 20 轮用户反馈）：rebuildRowAsActive 把 targetAlpha 永久
    // 改成 1，激活过的行失活后按 1×衰减 回落，比从未激活的行（0.54 基准）
    // 整体亮一档 —— "已激活过的歌词行会一直保持亮度"。targetAlpha 必须
    // 保持构建时的上下文基准，激活亮度只由逐帧 isActive 分支决定。
    const source = stripComments(LYRIC_STAGE)
    const fn = source.match(/const rebuildRowAsActive\s*=\s*\(row[\s\S]*?^ {2}\}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).not.toMatch(/targetAlpha\s*=\s*[^=]/)
  })

  it('滚动轨道目标必须是激活行的虚拟槽位（译词行占槽，行距随内容展开）', () => {
    const source = stripComments(LYRIC_STAGE)
    expect(source).toMatch(/slotInfo\.slotStart\[active\]/)
  })

  it('着色器激活门控使用 uActiveMix uniform，不再读纹理 R 通道', () => {
    const source = stripComments(LYRIC_SHADERS)
    expect(source).toMatch(/uniform float uActiveMix/)
    expect(source).not.toMatch(/texel\.r/)
    expect(source).not.toMatch(/rowActive\s*=\s*smoothstep/)
  })

  it('着色器 GLSL 自检：activeMix 必须有声明（防止删声明留使用 → 编译失败 → 主文字整层消失）', () => {
    // 真实事故：第 16 轮编辑着色器时删掉了 `float activeMix = ...` 声明，
    // 但 fragment 里 8 处使用仍在 —— GLSL 编译失败时 three 会跳过该材质
    // 的渲染（主文字网格整层消失），只剩不受影响的描边层在滚动。
    const body = stripComments(LYRIC_SHADERS)
    expect(body).toMatch(/float\s+activeMix\s*=/)
    // 声明之后的使用次数应比声明前多（即使用处全部在声明之后）
    const declareAt = body.indexOf('float activeMix =')
    const usesAfter = (body.slice(declareAt).match(/\bactiveMix\b/g) ?? []).length
    expect(usesAfter).toBeGreaterThan(1)
  })

  it('着色器 GLSL 自检：所有 uniform 声明都有对应使用（无死 uniform / 无未声明使用）', () => {
    const fragMatch = LYRIC_SHADERS.match(/LYRIC_FRAGMENT_SHADER = \/\* glsl \*\/ `([\s\S]*?)`/)
    expect(fragMatch).toBeTruthy()
    const frag = stripComments(fragMatch![1])
    const uniforms = [...frag.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1])
    expect(uniforms.length).toBeGreaterThan(0)
    for (const name of uniforms) {
      const uses = (frag.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length
      // 声明本身占 1 次，必须至少还有 1 次真实使用
      expect(uses, `uniform ${name} 声明了但从未使用`).toBeGreaterThanOrEqual(2)
    }
  })

  it('显示模式必须真正门控行数（上游 lyricLineAllowedForDisplayMode）', () => {
    // 真实缺陷：`lyricSlotOffsets` 存在且被单测覆盖，但**生产路径从不调用** ——
    // 只用 stackLines 算了一个对称可见半径。后果：
    //   single（应 1 行）实际显示前后各 ~1 行
    //   dual（上游是 [0,1]，当前 + 下一行）显示 ±2 行
    //   cinema 半径 5.3 槽位在译词展开后能容下 10+ 行
    const source = stripComments(LYRIC_STAGE)
    // 必须真的调用 lyricSlotOffsets 并用它做门控
    expect(source).toMatch(/lyricSlotOffsets\(/)
    // modeAllowed 必须**由 allowedOffsets 推导**，而不是恒真
    // （恒真即门控失效 —— 只断言标识符存在会漏掉这个回归）
    expect(source).toMatch(/const modeAllowed = isActive \|\| allowedOffsets\.has\(/)
    // 不在偏移集内 → contextAlpha 归零
    expect(source).toMatch(/!modeAllowed\s*\?\s*0/)
  })

  it('各向异性按硬件画像分档，不得硬编码（上游 configureLyricTextureSampling）', () => {
    // 上游 10-lyrics-mask-textures.js:31-32：
    //   anisotropyBudget = lowSpec ? 4 : balancedSpec ? 8 : 16
    // 此前本项目硬编码 Math.min(8, maxAnisotropy)，把低端抬到中档、高端压到中档。
    const source = stripComments(LYRIC_STAGE)
    expect(source).toMatch(/lowSpec\s*\?\s*4\s*:\s*\w+\.balancedSpec\s*\?\s*8\s*:\s*16/)
    // 纹理赋值的右侧不得再用硬编码的数字（只看赋值语句，不看注释文字）
    const assignments = source.match(/texture\.anisotropy\s*=\s*[^\n]+/g) ?? []
    expect(assignments.length).toBeGreaterThan(0)
    for (const line of assignments) {
      expect(line, `各向异性被硬编码：${line}`).not.toMatch(/Math\.min\(\s*\d/)
    }
  })

  it('时间Stretch 失败时元素不得回池（孤儿 source 防护）', () => {
    const timeStretch = stripComments(
      readFileSync(join(__dirname, '../../../../lib/timeStretch.ts'), 'utf8'),
    )
    // attach 一开始就登记占位禁用图
    expect(timeStretch).toMatch(/graphByAudio\.set\(audio,\s*createDisabledGraph\(context,\s*audio\)\)/)
    // 失败分支把未接管的元素从 Howler 池里摘除
    expect(timeStretch).toMatch(/retireAudioElement\(audio\)/)
    // retire 函数确实操作 _html5AudioPool
    expect(timeStretch).toMatch(/_html5AudioPool/)
  })
})
