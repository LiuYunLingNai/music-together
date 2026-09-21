import { describe, expect, it } from 'vitest'
import {
  PRESET_INDEX,
  VISUAL_MODES,
  getVisualMode,
  isTopographyMode,
  isVisualStageId,
  usesParticlePreset,
} from './VisualMode'
import { VISUAL_STAGES } from '@/lib/storage'

describe('视觉模式注册表', () => {
  it('包含声波地形（对应 OpenMusic「声波地形」/ Mineradio sonic-topography）', () => {
    expect(VISUAL_MODES.some((mode) => mode.id === 'topography')).toBe(true)
    expect(getVisualMode('topography').label).toBe('声波地形')
  })

  it('声波地形不走粒子着色器分支，也没有 uPreset 编号', () => {
    expect(usesParticlePreset('topography')).toBe(false)
    expect(isTopographyMode('topography')).toBe(true)
    expect(Object.keys(PRESET_INDEX)).not.toContain('topography')
  })

  /**
   * 第九轮用户决策：「封面视界」（曾自创复用 3 号槽位）已删除。
   * `PRESET_INDEX` 不得再出现 `cover`，3 号槽位（上游 VOID）留空。
   */
  it('封面视界已删除：不得再有 cover 模式或 3 号槽位', () => {
    const ids = VISUAL_MODES.map((mode) => mode.id) as string[]
    expect(ids).not.toContain('cover')
    expect(Object.keys(PRESET_INDEX)).not.toContain('cover')
  })

  it('除声波地形外的所有模式都走粒子预设分支', () => {
    for (const mode of VISUAL_MODES) {
      expect(usesParticlePreset(mode.id)).toBe(mode.id !== 'topography')
    }
  })

  it('其余五种模式与上游 uPreset 编号一一对应', () => {
    const expected: Record<string, number> = {
      emily: 0,
      tunnel: 1,
      planet: 2,
      vinyl: 4,
      galaxy: 5,
    }
    for (const [mode, index] of Object.entries(expected)) {
      expect(PRESET_INDEX[mode as keyof typeof PRESET_INDEX]).toBe(index)
    }
    // 编号必须唯一，否则切模式会复用同一分支
    expect(new Set(Object.values(PRESET_INDEX)).size).toBe(Object.keys(PRESET_INDEX).length)
  })

  /**
   * 回归：`VISUAL_STAGES`（持久化白名单）与 `VISUAL_MODES`（菜单来源）
   * 是两份手工维护的列表。任一新增模式时漏改另一边，就会表现为
   * 「菜单里能选，但刷新后被静默丢弃」——这个测试把两者钉在一起。
   */
  it('持久化白名单与模式注册表始终一致', () => {
    const stageIds = VISUAL_STAGES.filter((stage) => stage !== 'classic').sort()
    const modeIds = VISUAL_MODES.map((mode) => mode.id).sort()
    expect(stageIds).toEqual(modeIds)
  })

  it('每个模式都能被 isVisualStageId 识别（保证可持久化）', () => {
    for (const mode of VISUAL_MODES) {
      expect(isVisualStageId(mode.id)).toBe(true)
    }
  })

  it('id 唯一', () => {
    const ids = VISUAL_MODES.map((mode) => mode.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
