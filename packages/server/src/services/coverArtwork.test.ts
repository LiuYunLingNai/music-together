import { describe, expect, it } from 'vitest'
import { deriveThumbnailCoverUrl, normalizeHighQualityCoverUrl } from './coverArtwork.js'

describe('cover artwork helpers', () => {
  it('separates NetEase detail artwork from thumbnails', () => {
    const source = 'http://p1.music.126.net/example.jpg?param=300y300'
    expect(normalizeHighQualityCoverUrl('netease', source)).toMatch(/^https:/)
    expect(normalizeHighQualityCoverUrl('netease', source)).not.toContain('param=')
    expect(deriveThumbnailCoverUrl('netease', source)).toContain('param=120y120')
  })

  it('derives Tencent sizes without changing the album id', () => {
    const source = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg'
    expect(normalizeHighQualityCoverUrl('tencent', source)).toContain('T002R800x800M000abc')
    expect(deriveThumbnailCoverUrl('tencent', source)).toContain('T002R120x120M000abc')
  })

  it('leaves unknown and Bilibili URLs untouched', () => {
    const source = 'https://i0.hdslb.com/bfs/archive/example.jpg'
    expect(normalizeHighQualityCoverUrl('bilibili', source)).toBe(source)
    expect(deriveThumbnailCoverUrl('bilibili', source)).toBe(source)
  })
})
