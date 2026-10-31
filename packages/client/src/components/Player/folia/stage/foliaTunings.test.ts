import { describe, expect, it } from 'vitest'
import { createFoliaTuningResolver } from './foliaTunings'

describe('stage-owned Folia tuning resolver', () => {
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
