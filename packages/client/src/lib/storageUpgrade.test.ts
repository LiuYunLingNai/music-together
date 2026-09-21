// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 升级路径验收：模拟"老用户"的 localStorage，跑真实迁移，确认
 * ①不抛错 ②旧值被合理映射 ③无关设置不被改动 ④缺失/畸形值安全回退。
 */
describe('老用户升级路径', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear() })

  it('v2 老用户（自拟三档画质）升级后画质被映射，其余设置原样', async () => {
    localStorage.setItem('mt-settingsSchemaVersion', '2')
    localStorage.setItem('mt-visualQuality', 'medium')
    localStorage.setItem('mt-visualStage', 'emily')
    localStorage.setItem('mt-lyricRenderer', 'amll')
    localStorage.setItem('mt-lyricFontSize', '90')
    localStorage.setItem('mt-playbackTempoSyncEnabled', 'true')

    const s = (await import('./storage')).storage
    expect(s.getVisualQuality()).toBe('balanced')     // medium -> balanced
    expect(s.getVisualStage()).toBe('emily')          // untouched
    expect(s.getLyricRenderer()).toBe('amll')         // untouched
    expect(s.getLyricFontSize()).toBe(90)             // untouched
    expect(s.getPlaybackTempoSyncEnabled()).toBe(true) // untouched
  })

  it('全新用户（无任何键）不抛错且取到默认值', async () => {
    const s = (await import('./storage')).storage
    expect(s.getVisualQuality()).toBe('auto')
    expect(s.getVisualBloom()).toBe(false)
    expect(s.getVisualEdge()).toBe(false)
    expect(s.getVisualStage()).toBe('classic')
  })

  it('畸形值安全回退（不抛错）', async () => {
    localStorage.setItem('mt-visualQuality', '{not json')
    localStorage.setItem('mt-visualBloom', 'maybe')
    localStorage.setItem('mt-settingsSchemaVersion', 'garbage')
    const s = (await import('./storage')).storage
    expect(s.getVisualQuality()).toBe('auto')
    expect(s.getVisualBloom()).toBe(false)
  })

  it('已经是 v3 的用户再加载不会被再次迁移', async () => {
    localStorage.setItem('mt-settingsSchemaVersion', '3')
    localStorage.setItem('mt-visualQuality', 'ultra')
    const s = (await import('./storage')).storage
    expect(s.getVisualQuality()).toBe('ultra')
  })
})
