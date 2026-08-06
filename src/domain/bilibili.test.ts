import { describe, expect, it } from 'vitest'
import { BILIBILI_METADATA_SOURCES, bilibiliVideoId } from './bilibili'

describe('Bilibili collection metadata', () => {
  it('uses the canonical BV id for a selected multi-part video', () => {
    expect(bilibiliVideoId({ sourceId: 'BV1373n6rEcP', urlId: 'BV1373n6rEcP?cid=39252201462' })).toBe('BV1373n6rEcP')
  })

  it('rejects invalid collection identifiers', () => {
    expect(bilibiliVideoId({ sourceId: 'not-a-bvid', urlId: 'https://example.com/video' })).toBeNull()
  })

  it('offers all supported lyric and cover metadata sources', () => {
    expect(BILIBILI_METADATA_SOURCES).toEqual(['netease', 'tencent', 'kugou', 'kugou_concept'])
  })
})
