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
    previous.setFoliaSettings({ background: 'geometric', barOffset: 80, autoHide: true })
    previous.setFoliaSettings({ showProgress: false })
    expect(storage.getFoliaSettings()).toMatchObject({
      background: 'geometric',
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
