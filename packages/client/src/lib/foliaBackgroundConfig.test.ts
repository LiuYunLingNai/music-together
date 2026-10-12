import { describe, expect, it } from 'vitest'
import { FOLIA_BACKGROUNDS, normalizeFoliaSettings } from './foliaSettings'
import { FOLIA_MODES } from './foliaModes'
import { normalizeFoliaBackgroundConfig } from './foliaBackgroundConfig'

describe('完整 Folia 配置', () => {
  it('六种上游背景都可以保存；保留已有的柔焦、几何和纯色', () => {
    for (const id of ['common', 'latent', 'monet', 'nomand', 'sora', 'url', 'fluid', 'geometric', 'solid']) {
      expect(FOLIA_BACKGROUNDS.some((item) => item.id === id)).toBe(true)
      expect(normalizeFoliaSettings({ background: id }).background).toBe(id)
    }
  })
  it('十四个动画的持久化模式完整且不与经典播放器混淆', () => {
    for (const mode of FOLIA_MODES) expect(normalizeFoliaSettings({ lyricMode: mode.id }).lyricMode).toBe(mode.id)
    expect(normalizeFoliaSettings({ lyricMode: 'classic' }).lyricMode).toBe('luminous')
  })
  it('校验背景参数和网址，丢弃非法嵌入地址及无效选择', () => {
    const settings = normalizeFoliaBackgroundConfig({
      latent: { tuning: { meshSpeed: Infinity, displayMode: 'nope' } },
      monet: { tuning: { backgroundBlurPx: 900, backgroundLayout: 'unknown' } },
      nomand: { tuning: { effect: 'paper-texture', size: -8 } },
      customImage: { url: 'javascript:alert(1)' },
      url: {
        items: [
          { id: 'safe', url: 'https://example.com/bg', note: '背景' },
          { id: 'unsafe', url: 'data:text/html,<script>', note: '' },
        ],
        selectedId: 'unsafe',
      },
    })
    expect(settings.latent?.tuning?.meshSpeed).toBe(0.3)
    expect(settings.monet?.tuning?.backgroundBlurPx).toBe(80)
    expect(settings.nomand?.tuning).toMatchObject({ effect: 'paper-texture', size: 0.5 })
    expect(settings.customImage).toBeUndefined()
    expect(settings.url).toMatchObject({ items: [{ id: 'safe' }], selectedId: null })
  })
  it('动画参数限制范围和枚举，未知键不会进入运行时', () => {
    const settings = normalizeFoliaSettings({
      tunings: {
        sonnet: { cameraIntensity: 100, outerFrameMode: 'nope', showOnlyText: 'yes', privateKey: 'unused' },
        tilt: { colorScheme: 'swap' },
      },
    })
    expect(settings.tunings.sonnet).toEqual({ cameraIntensity: 2 })
    expect(settings.tunings.tilt).toEqual({ colorScheme: 'swap' })
  })
})
