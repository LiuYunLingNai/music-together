import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 回归：舞台外壳（`AudioPlayer.tsx`）的两个真实缺陷。
 *
 * 这两处都是**功能可用性**问题，都会让用户"点不动 / 看不到东西"，
 * 而且都不会被 typecheck 或任何现有测试发现（它们只改运行时行为）。
 */
const AUDIO_PLAYER = readFileSync(join(__dirname, '../AudioPlayer.tsx'), 'utf8')

/** 去掉注释，避免把说明文字里的代码也算进去。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('舞台外壳：故障回退与视图切换', () => {
  const body = stripComments(AUDIO_PLAYER)

  /**
   * 真实缺陷：`StageErrorBoundary.componentDidCatch` 只 `console.warn`，
   * `render()` 返回 `null` —— 懒加载 chunk 失败或 R3F `<Canvas>` 构造抛错时，
   * 用户看到的是**一块空白面板**且播放器控制永久消失，只能切模式或刷新恢复。
   *
   * `onUnavailable` 在 props 里声明了却从未被调用（`handleUnavailable`
   * 因此永远不会把持久化舞台改回 classic）。
   */
  it('错误边界必须在捕获异常时回写 classic（不得只打日志渲染 null）', () => {
    const fn = body.match(/componentDidCatch\s*\([\s\S]*?\n {2}\}/)
    expect(fn, 'componentDidCatch 未找到').toBeTruthy()
    // 必须调用 props 上的 onUnavailable
    expect(fn![0]).toMatch(/this\.props\.onUnavailable\(\)/)
  })

  /**
   * 真实缺陷：经典舞台的整页歌单（`view === 'playlist'`）是它独有的；
   * 视觉舞台只在 `view === 'player'` 时渲染。用户在经典舞台点进整页歌单、
   * 再选一个视觉模式时，`view` 仍是 'playlist' —— 渲染的还是经典舞台，
   * 而菜单里视觉模式已高亮，看起来像"舞台切换坏了"。
   */
  it('选择视觉模式时必须把视图切回 player（否则菜单选中但画面不变）', () => {
    const fn = body.match(/const handleSelectStage[\s\S]*?\[[^\]]*\]\s*,?\s*\)/)
    expect(fn, 'handleSelectStage 未找到').toBeTruthy()
    // 必须存在"非 classic 且 view 不是 player 时切回"的逻辑
    expect(fn![0]).toMatch(/next !== 'classic'/)
    expect(fn![0]).toMatch(/onToggleView\(\)/)
  })

  it('视觉舞台的渲染条件含 view === player（该前提本身是对的，需保留）', () => {
    expect(body).toMatch(/isMineradio && view === 'player'/)
  })
})
