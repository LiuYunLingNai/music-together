import { describe, expect, it } from 'vitest'
import { looksLikeMusicId, normalizeMusicId, parseMusicLink, supportsIdLookup } from './musicRef.js'

describe('musicRef', () => {
  it('识别网易云分享链接的种类与 ID', () => {
    expect(parseMusicLink('分享 https://music.163.com/#/playlist?id=123456789 给你')).toEqual({
      source: 'netease',
      kind: 'playlist',
      id: '123456789',
    })
  })

  it('链接指向另一个平台或种类时不猜测', () => {
    expect(normalizeMusicId('tencent', 'song', 'https://music.163.com/#/song?id=1234567')).toBeNull()
    expect(normalizeMusicId('netease', 'album', 'https://music.163.com/#/song?id=1234567')).toBeNull()
  })

  it('短数字和普通词按关键词处理，长数字才当作 ID', () => {
    expect(looksLikeMusicId('netease', 'song', '1975')).toBe(false)
    expect(looksLikeMusicId('netease', 'song', '1234567')).toBe(true)
    expect(looksLikeMusicId('netease', 'song', 'hello world')).toBe(false)
  })

  it('酷狗歌曲用 32 位哈希，歌手页只支持网易云', () => {
    expect(normalizeMusicId('kugou', 'song', 'A'.repeat(32))).toBe('A'.repeat(32))
    expect(supportsIdLookup('kugou', 'artist')).toBe(false)
    expect(supportsIdLookup('bilibili', 'song')).toBe(false)
  })
})
