// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLIA_DEFAULTS, normalizeFoliaSettings } from './foliaSettings'
import { storage } from './storage'
import { useSettingsStore } from '@/stores/settingsStore'
import { usePlayerStore } from '@/stores/playerStore'

describe('Folia 设置保存与升级', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.getState().resetFoliaSettings()
  })
  it('损坏、未知或部分设置安全回退，并限制数字范围', () => {
    expect(normalizeFoliaSettings(null)).toEqual(FOLIA_DEFAULTS)
    expect(normalizeFoliaSettings([])).toEqual(FOLIA_DEFAULTS)
    expect(
      normalizeFoliaSettings({ background: 'nope', lyricMode: 'classic', autoHide: 'false', fontScale: NaN }),
    ).toEqual(FOLIA_DEFAULTS)
    expect(
      normalizeFoliaSettings({ backgroundDim: 9, barOffset: -5, fontScale: 3, subtitleScale: 0, showProgress: false }),
    ).toMatchObject({ backgroundDim: 0.85, barOffset: 16, fontScale: 1.8, subtitleScale: 0.6, showProgress: false })
    localStorage.setItem('mt-foliaSettings', '{invalid')
    expect(storage.getFoliaSettings()).toEqual(FOLIA_DEFAULTS)
  })
  it('首次升级记住原有歌词模式，随后尊重独立保存的模式', () => {
    localStorage.removeItem('mt-foliaSettings')
    localStorage.setItem('mt-visualStage', 'cappella')
    expect(storage.getFoliaSettings().lyricMode).toBe('cappella')
    storage.setFoliaSettings({ ...FOLIA_DEFAULTS, lyricMode: 'tilt', background: 'sora' })
    expect(storage.getFoliaSettings()).toMatchObject({ lyricMode: 'tilt', background: 'sora' })
  })
  it('修改与恢复 Folia 不改变音量、播放时间、舞台选择或其他设置', () => {
    const previous = useSettingsStore.getState()
    const player = usePlayerStore.getState()
    previous.setFoliaSettings({ background: 'latent', barOffset: 80, autoHide: true })
    previous.setFoliaSettings({ showProgress: false })
    expect(storage.getFoliaSettings()).toMatchObject({
      background: 'latent',
      barOffset: 80,
      autoHide: true,
      showProgress: false,
    })
    expect(useSettingsStore.getState().visualStage).toBe(previous.visualStage)
    expect(useSettingsStore.getState().bgFps).toBe(previous.bgFps)
    previous.resetFoliaSettings()
    expect(storage.getFoliaSettings()).toEqual(FOLIA_DEFAULTS)
    expect(usePlayerStore.getState()).toBe(player)
  })
  it('本地存储被禁用时仍能使用与修改设置', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(storage.getFoliaSettings()).toEqual(FOLIA_DEFAULTS)
    expect(() => useSettingsStore.getState().setFoliaSettings({ background: 'solid' })).not.toThrow()
    expect(useSettingsStore.getState().foliaSettings.background).toBe('solid')
  })
})

describe('folia tuning 嵌套路径与上游 clamp', () => {
  it('diorama 的 geometryVisibility 嵌套对象能保存并合并回默认值', () => {
    const saved = normalizeFoliaSettings({
      tunings: {
        diorama: {
          'geometryVisibility.mode': 'corridor',
          'geometryVisibility.strands': false,
          particleScale: 9,
        },
      },
    })
    expect(saved.tunings.diorama?.geometryVisibility).toMatchObject({
      mode: 'corridor',
      strands: false,
    })
    // 越界值被 clamp（上游 DIORAMA_PARTICLE_SCALE 0.65-1.6）
    expect(saved.tunings.diorama?.particleScale).toBe(1.6)
  })

  it('resolveFoliaTuning 合并嵌套对象时不共享默认值引用', async () => {
    const { resolveFoliaTuning } = await import('@/components/Player/folia/stage/foliaTunings')
    const a = resolveFoliaTuning('diorama', {})
    const b = resolveFoliaTuning('diorama', {})
    expect(a.geometryVisibility).not.toBe(b.geometryVisibility)
    const patched = resolveFoliaTuning('diorama', { diorama: { 'geometryVisibility.mode': 'corridor' } })
    expect((patched.geometryVisibility as { mode: string }).mode).toBe('corridor')
    // 未提供的子字段回落默认
    expect((patched.geometryVisibility as { enabled: boolean }).enabled).toBe(true)
  })

  it('diorama 三个镜头类滑条的 clamp 与上游 settingsPanels 一致', () => {
    const saved = normalizeFoliaSettings({
      tunings: { diorama: { cameraSpeed: 9, motionAmount: -1, audioReactivity: 5 } },
    })
    expect(saved.tunings.diorama?.cameraSpeed).toBe(1.85)
    expect(saved.tunings.diorama?.motionAmount).toBe(0.4)
    expect(saved.tunings.diorama?.audioReactivity).toBe(1.5)
  })
})
