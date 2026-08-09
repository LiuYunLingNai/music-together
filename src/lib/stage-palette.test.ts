import { describe, expect, it } from 'vitest'
import { extractStagePalette } from './stage-palette'

describe('stage palette', () => {
  it('selects distinct opaque colors and ignores transparent pixels', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 180, 120, 255,
      0, 0, 255, 255,
      255, 255, 0, 0,
    ])
    const palette = extractStagePalette(pixels)
    expect(palette.colors).toHaveLength(4)
    expect(new Set(palette.colors).size).toBe(4)
    expect(palette.accent).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
  })

  it('returns a readable fallback for an empty image', () => {
    const palette = extractStagePalette(new Uint8ClampedArray(), true)
    expect(palette.colors).toHaveLength(4)
    expect(palette.colors[0]).not.toBe(palette.colors[1])
  })
})
