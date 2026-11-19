import { describe, expect, it } from 'vitest'
import { createFoliaTuningResolver, resolveFoliaTuning } from './foliaTunings'
import { normalizeFoliaSettings } from '@/lib/foliaSettings'
import monetTuning from '../upstream/components/visualizer/monet/tuning'

describe('stage-owned Folia tuning resolver', () => {
  it('preserves the new major settings while normalizing stored values', () => {
    const saved = normalizeFoliaSettings({ tunings: {
      monet: { mirrorLayout: true, portraitSource: 'none', customDescription: '我的描述', descriptionVisibility: 'always' },
      pendolo: { tiltDeg: 20, hubView: true, parallaxDepth: 2 },
      claddagh: { positionX: 90, showTranslation: true, translationScale: 1.4 },
      metaphor: { cutPace: 99, grain: 0.4, transitions: false },
    } })
    expect(resolveFoliaTuning('monet', saved.tunings)).toMatchObject({ mirrorLayout: true, portraitSource: 'none', customDescription: '我的描述', descriptionVisibility: 'always' })
    expect(resolveFoliaTuning('pendolo', saved.tunings)).toMatchObject({ tiltDeg: 20, hubView: true, parallaxDepth: 2 })
    expect(resolveFoliaTuning('claddagh', saved.tunings)).toMatchObject({ positionX: 40, showTranslation: true, translationScale: 1.4 })
    expect(resolveFoliaTuning('metaphor', saved.tunings)).toMatchObject({ cutPace: 2, grain: 0.4, transitions: false })
  })
  it('migrates Monet visibility switches without losing the linked three-way setting', () => {
    const legacy = monetTuning.storage!.read({ showDescription: false, showPortraitDragHanger: false })
    expect(legacy).toMatchObject({ descriptionVisibility: 'hidden', portraitHangerVisibility: 'hidden' })
    const changed = monetTuning.storage!.merge(legacy, { descriptionVisibility: 'always' })
    expect(changed).toMatchObject({ showDescription: true, descriptionVisibility: 'always' })
    expect(changed.portraitHangerVisibility).toBe('hidden')
  })
  it('new modes have their own settings and cached resolution', () => {
    const resolve = createFoliaTuningResolver({ tunings: {}, fontScale: 1 })
    expect(resolve('metaphor').metaphorTuning).toBeDefined()
    expect(resolve('metaphor')).toBe(resolve('metaphor'))
    expect(resolve('prompt')).toEqual({})
    expect(resolve('kinetic').kineticTuning).toMatchObject({ style: 'noir', scope: 'global' })
  })
  it('reuses each mode while preserving outgoing-mode settings', () => {
    const resolve = createFoliaTuningResolver({ tunings: {}, fontScale: 1 })
    const tilt = resolve('tilt')
    const diorama = resolve('diorama')
    expect(resolve('tilt')).toBe(tilt)
    expect(resolve('diorama')).toBe(diorama)
    expect(tilt.tiltTuning).toBeDefined()
    expect(tilt.dioramaTuning).toBeUndefined()
    expect(diorama.dioramaTuning).toBeDefined()
  })

  it('keeps nested defaults isolated between stages and applies changed font scale', () => {
    const first = createFoliaTuningResolver({ tunings: {}, fontScale: 1 })
    const second = createFoliaTuningResolver({ tunings: {}, fontScale: 1.5 })
    expect(first('diorama').dioramaTuning?.geometryVisibility)
      .not.toBe(second('diorama').dioramaTuning?.geometryVisibility)
    expect(second('cadenza').cadenzaTuning?.fontScale)
      .toBe(Number(first('cadenza').cadenzaTuning?.fontScale) * 1.5)
  })
})
