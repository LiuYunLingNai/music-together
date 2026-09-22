import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISUAL_STAGE_DISABLED_QUERY, isVisualStageDisabled, resolveEffectiveVisualStage } from './visualStageSupport'

/**
 * Web 移动端不提供视觉舞台入口 —— 判据与接线契约。
 *
 * 用户诉求：「考虑到移动端的性能功耗表现，把 web 移动端的 mineradio 入口
 * 隐藏掉，**不要影响 web 桌面端的正常入口**」。
 *
 * 因此本文件的断言分两类：
 *   ① 纯函数语义：**判据只看触摸、不看窗口宽度**（后者会误伤桌面窄窗口）；
 *   ② 源码接线：三个入口（播放器菜单 / 设置面板 / 持久化回写）都被接上，
 *      且经典播放器路径**完全不受影响**。
 *
 * ★ 第 ② 类必须读源码而不能只测纯函数：判据写对了、但某个入口忘了接，
 *   功能就是坏的（用户仍能选到视觉模式），而纯函数测试照样全绿。
 */
const HERE = __dirname
const SUPPORT = readFileSync(join(HERE, 'visualStageSupport.ts'), 'utf8')
const HOOK = readFileSync(join(HERE, '..', 'hooks', 'useVisualStageSupport.ts'), 'utf8')
const SHELL = readFileSync(join(HERE, '..', 'components', 'Player', 'AudioPlayer.tsx'), 'utf8')
const APPEARANCE = readFileSync(join(HERE, '..', 'components', 'Overlays', 'Settings', 'AppearanceSection.tsx'), 'utf8')
const RENDER_POLICY = readFileSync(
  join(HERE, '..', 'components', 'Player', 'mineradio', 'shared', 'RenderPolicy.ts'),
  'utf8',
)

/** 去掉注释，避免把说明文字里的标识符也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('视觉舞台可用性 · 判据语义', () => {
  it('触摸设备（主指针 coarse）→ 禁用', () => {
    expect(isVisualStageDisabled(true)).toBe(true)
  })

  it('鼠标/触摸板（主指针 fine）→ 保留入口', () => {
    expect(isVisualStageDisabled(false)).toBe(false)
  })

  it('★ 判据不得含窗口尺寸（否则桌面窄窗口会丢入口）', () => {
    const body = stripComments(SUPPORT)
    // 不得出现任何宽度/尺寸媒体查询或 innerWidth 判断
    expect(body, '判据里出现了宽度 —— 会把桌面窄窗口误判为移动端').not.toMatch(
      /max-width|min-width|innerWidth|clientWidth|offsetWidth|\bwidth\b/i,
    )
    // 也不得用 maxTouchPoints（触屏笔记本会被误判）
    expect(body, '用 maxTouchPoints 会误伤触屏笔记本').not.toMatch(/maxTouchPoints/)
  })

  it('★ 判据必须与低功耗档同源（都是 pointer: coarse）', () => {
    // 两处判据若分叉，会出现"入口可见但按低功耗跑"或反之的矛盾状态。
    expect(VISUAL_STAGE_DISABLED_QUERY).toBe('(pointer: coarse)')
    expect(RENDER_POLICY, 'RenderPolicy 的 lowPower 判据与入口判据不一致').toMatch(
      /matchMedia\?\.\('\(pointer: coarse\)'\)/,
    )
  })

  it('禁用时实际渲染的舞台回落为 classic，但纯函数不负责改写存储', () => {
    expect(resolveEffectiveVisualStage('emily', true)).toBe('classic')
    expect(resolveEffectiveVisualStage('topography', true)).toBe('classic')
    // 未禁用时原样透传（含 classic 本身）
    expect(resolveEffectiveVisualStage('emily', false)).toBe('emily')
    expect(resolveEffectiveVisualStage('classic', false)).toBe('classic')
  })
})

describe('视觉舞台可用性 · 接线契约', () => {
  it('① 播放器菜单：禁用时整个容器不渲染（不是只隐藏按钮）', () => {
    const body = stripComments(SHELL)
    expect(body, '未使用 useVisualStageSupport').toMatch(/useVisualStageSupport\(\)/)
    // 容器必须被条件包住 —— 留空容器会挡住经典舞台右上角的歌单按钮
    expect(body).toMatch(/\{!visualDisabled && \(/)
    // 渲染分支必须用推导值，而不是直接读 store
    expect(body, '渲染分支仍直接读 store 的 visualStage').toMatch(/const visualStage = effectiveVisualStage/)
    expect(body, '仍从 store 直接取 visualStage，与推导值分叉').not.toMatch(
      /const visualStage = useSettingsStore\(\(s\) => s\.visualStage\)/,
    )
  })

  it('② 选择回调必须拒绝在禁用设备上写入视觉模式（设置面板不是后门）', () => {
    const body = stripComments(SHELL)
    // 用"起点 + 固定窗口"截取，而不是靠结尾定界符做正则 ——
    // 函数体的结尾缩进一旦被格式化工具改动，定界符式正则会静默失配。
    const start = body.indexOf('const handleSelectStage')
    expect(start, '未找到 handleSelectStage').toBeGreaterThan(-1)
    const fn = body.slice(start, start + 600)
    const end = fn.indexOf('[setVisualStage,')
    expect(end, '未取到 handleSelectStage 的函数体').toBeGreaterThan(-1)
    const fnBody = fn.slice(0, end)
    // 必须在写 store 之前早退
    const guardAt = fnBody.indexOf('if (visualDisabled) return')
    const writeAt = fnBody.indexOf('setVisualStage(next)')
    expect(guardAt, '缺少禁用守卫 —— 设置面板可绕过入口限制').toBeGreaterThan(-1)
    expect(writeAt, '未找到 setVisualStage(next)').toBeGreaterThan(-1)
    expect(guardAt, '守卫必须在写入之前').toBeLessThan(writeAt)
  })

  it('③ 设置面板：视觉舞台整块被门控，背景渲染块**保留**', () => {
    const body = stripComments(APPEARANCE)
    expect(body, '设置面板未接入口判据').toMatch(/useVisualStageDisabled\(\)/)
    expect(body).toMatch(/\{!visualStageDisabled && \(/)
    // ★ 反向确认：背景渲染块必须仍在条件之外 —— 经典播放器也读这三个值
    //   （classic/ClassicPlayerStage.tsx:78-80），一起藏掉会是功能回归。
    const gateAt = body.indexOf('!visualStageDisabled')
    expect(gateAt, '未找到门控').toBeGreaterThan(-1)
    expect(body.slice(0, gateAt), '背景渲染块被误纳入门控').toMatch(/背景渲染/)
    expect(body.slice(0, gateAt), '背景渲染的频率设置被误纳入门控').toMatch(/bgFps/)
  })

  it('④ 持久化回写：禁用时必须把存储值写回 classic，且写在 effect 里', () => {
    const body = stripComments(HOOK)
    expect(body).toMatch(/setVisualStage\('classic'\)/)
    // 必须放在 useEffect 内（渲染期写 store 会触发 React 告警 + 可能循环）
    const effect = body.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[disabled[^\]]*\]\)/)
    expect(effect, '回写未放在 effect 里').toBeTruthy()
    expect(effect![0]).toMatch(/setVisualStage\('classic'\)/)
    // 已是 classic 时不得重复写入（否则每次渲染都 set 一次 store）
    expect(effect![0], '缺少 classic 早退 —— 会无谓触发布局更新').toMatch(/storedVisualStage === 'classic'\)\s*return/)
  })

  it('⑤ 判据必须支持热插拔（平板接鼠标后入口恢复）', () => {
    const body = stripComments(HOOK)
    expect(body).toMatch(/addEventListener\('change'/)
    expect(body).toMatch(/removeEventListener\('change'/)
  })

  it('⑤b 判据必须在**首次渲染**就确定（不得只在 effect 里设，否则移动端会闪一帧重舞台）', () => {
    // 若 disabled 初值是 false、只在 effect 里改，触摸设备上首帧会按
    // 存储的 'emily' 渲染 —— three.js chunk 被拉取、舞台闪现一下才切回经典。
    // 因此初值必须由 useState 的**惰性初始化**同步读 matchMedia。
    const body = stripComments(HOOK)
    expect(body, 'useState 未用惰性初始化同步读 matchMedia').toMatch(
      /useState\(\(\)\s*=>[\s\S]*?matchMedia\(VISUAL_STAGE_DISABLED_QUERY\)/,
    )
  })

  it('⑥ 经典播放器路径不得被牵连（无回归）', () => {
    // 经典舞台与歌词显示都不读入口判据 —— 它们本就与视觉舞台无关
    const classic = readFileSync(join(HERE, '..', 'components', 'Player', 'classic', 'ClassicPlayerStage.tsx'), 'utf8')
    expect(stripComments(classic)).not.toMatch(/visualStageSupport|useVisualStageDisabled/)
    const lyric = readFileSync(join(HERE, '..', 'components', 'Player', 'LyricDisplay.tsx'), 'utf8')
    expect(stripComments(lyric)).not.toMatch(/visualStageSupport|useVisualStageDisabled/)
  })
})

describe('视觉舞台懒加载红线不受影响（红线 3）', () => {
  it('入口判据模块不得引入 three / mineradio（否则会破坏按需加载）', () => {
    // `lib/visualStageSupport.ts` 与 `hooks/useVisualStageSupport.ts` 会被
    // 经典播放器路径**同步**加载；一旦它们 import 了 mineradio 或 three，
    // `dist/index.html` 就会出现 three 命中，红线 3 破防。
    for (const [name, source] of [
      ['lib/visualStageSupport.ts', SUPPORT],
      ['hooks/useVisualStageSupport.ts', HOOK],
    ] as const) {
      expect(source, `${name} 不得引用 mineradio`).not.toMatch(/from '[^']*mineradio/)
      expect(source, `${name} 不得引用 three`).not.toMatch(/from 'three'|@react-three/)
    }
  })

  it('入口判据只允许依赖 storage 的**类型**（不得拉入舞台运行时代码）', () => {
    // `import type` 在编译后被完全擦除，不产生运行时依赖，因此是安全的。
    expect(SUPPORT).toMatch(/import type \{ VisualStageSetting \} from '\.\/storage'/)
  })
})
