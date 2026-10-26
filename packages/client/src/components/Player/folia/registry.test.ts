import { describe, expect, it } from 'vitest'
import { FOLIA_MODES, getFoliaMode, isFoliaModeId } from './registry'
import { FOLIA_MODE_RENDERERS } from './renderers'
import { resolveStageFamily } from '../stages/registry'
import { VISUAL_STAGES } from '@/lib/storage'
import { VISUAL_MODES } from '../stages/VisualMode'

/**
 * Folia 舞台注册表 —— 结构回归。
 *
 * 这里钉住的是**手工维护的多份列表之间的一致性**，以及"路由必须认得每个
 * 注册项"。这类缺陷 typecheck 抓不到（两边都是合法类型），但运行时表现是
 * 「菜单能选、画面不变」或「刷新后被静默丢弃」。
 */
describe('folia 舞台注册表', () => {
  it('上游十五个模式完整注册，且 id 唯一', () => {
    expect(FOLIA_MODES.map((mode) => mode.upstreamId).sort()).toEqual(['cadenza','cappella','claddagh','classic','diorama','fume','hanabi','lumiere','monet','partita','pendolo','sonnet','still','tempera','tilt'])
    expect(FOLIA_MODES.find((mode) => mode.upstreamId === 'classic')?.id).toBe('luminous')
    const ids = FOLIA_MODES.map((mode) => mode.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个模式都有非空的中文名称与说明', () => {
    for (const mode of FOLIA_MODES) {
      expect(mode.label.length, `${mode.id} 缺少名称`).toBeGreaterThan(0)
      expect(mode.description.length, `${mode.id} 缺少说明`).toBeGreaterThan(0)
    }
  })

  it('菜单顺序严格递增（顺序决定用户在菜单里看到的排列）', () => {
    const orders = FOLIA_MODES.map((mode) => mode.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('isFoliaModeId 只认注册表里的 id', () => {
    for (const mode of FOLIA_MODES) {
      expect(isFoliaModeId(mode.id)).toBe(true)
    }
    expect(isFoliaModeId('classic')).toBe(false)
    expect(isFoliaModeId('emily')).toBe(false)
    expect(isFoliaModeId('nope')).toBe(false)
  })

  it('getFoliaMode 对未知 id 回退到第一个模式而不是抛错', () => {
    expect(getFoliaMode('nope' as never).id).toBe(FOLIA_MODES[0].id)
  })

  /**
   * ★ 关键：注册表里的**每一个** id 都必须有对应的懒加载组件。
   *   漏一个会让 `<ModeRenderer>` 取到 `undefined` 并在渲染时抛错，
   *   用户看到的是错误边界回退 classic（"选了就跳回经典播放器"）。
   */
  it('每个注册的模式都有对应的懒加载组件', () => {
    for (const mode of FOLIA_MODES) {
      expect(FOLIA_MODE_RENDERERS[mode.id], `${mode.id} 缺少渲染组件`).toBeDefined()
    }
    // 反向：渲染映射里不得有注册表之外的多余项
    expect(Object.keys(FOLIA_MODE_RENDERERS).sort()).toEqual(FOLIA_MODES.map((mode) => mode.id).sort())
  })
})

describe('统一舞台路由（两族）', () => {
  it('mineradio 的每个模式都被判为 mineradio 族', () => {
    for (const mode of VISUAL_MODES) {
      expect(resolveStageFamily(mode.id), `${mode.id} 的族判定错误`).toBe('mineradio')
    }
  })

  it('folia 的每个模式都被判为 folia 族', () => {
    for (const mode of FOLIA_MODES) {
      expect(resolveStageFamily(mode.id), `${mode.id} 的族判定错误`).toBe('folia')
    }
  })

  /**
   * ★ 未知 id 必须返回 null（调用方据此回退 classic），不能默认落进某一族：
   *   默认落进 folia 会让拼错的 id 在懒加载映射里取到 undefined 组件并抛错。
   */
  it('未知 id 返回 null（由调用方回退经典播放器）', () => {
    expect(resolveStageFamily('classic')).toBeNull()
    expect(resolveStageFamily('nope')).toBeNull()
    expect(resolveStageFamily('')).toBeNull()
  })

  it('VISUAL_STAGE_IDS 是两族之并，且不含 classic', () => {
    // 用 resolveStageFamily 反推，而不是读一个额外的导出常量：
    // 判据只有一处（那个函数），测试与实现不会各维护一份列表。
    const ids = [...VISUAL_MODES.map((mode) => mode.id), ...FOLIA_MODES.map((mode) => mode.id)]
    for (const id of ids) {
      expect(resolveStageFamily(id), `${id} 未被路由识别`).not.toBeNull()
    }
    expect(ids as readonly string[]).not.toContain('classic')
  })

  it('判据一致：注册表里的每个 id 都能被路由，classic 与未知值不能', () => {
    for (const mode of VISUAL_MODES) {
      expect(resolveStageFamily(mode.id)).not.toBeNull()
    }
    for (const mode of FOLIA_MODES) {
      expect(resolveStageFamily(mode.id)).not.toBeNull()
    }
    expect(resolveStageFamily('classic')).toBeNull()
    expect(resolveStageFamily('nope')).toBeNull()
  })

  /**
   * ★ 三份手工列表（持久化白名单 + 两族注册表）必须完全对齐。
   *   这是本文件最重要的一条：任何一份漏改都会造成"能选但存不下"或
   *   "存得下但路由不认"。
   */
  it('持久化白名单 = 两族注册表之并（多一份或漏一份都算失败）', () => {
    const whitelist = VISUAL_STAGES.filter((stage) => stage !== 'classic').sort()
    const registry = [...VISUAL_MODES.map((mode) => mode.id), ...FOLIA_MODES.map((mode) => mode.id)].sort()
    expect(whitelist).toEqual(registry)
  })
})
