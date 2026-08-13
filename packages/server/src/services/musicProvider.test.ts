import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tencentAuth from './tencentAuthService.js'
import { deriveThumbnailCoverUrl, musicProvider, normalizeKugouTemplateCoverUrl, normalizeNeteaseCoverUrl } from './musicProvider.js'

const tencentSong = {
  id: 410316279,
  mid: '003VHaBb0wCHop',
  name: 'Blank Space',
  interval: 231,
  singer: [{ id: 1, mid: 'singer-mid', name: 'Taylor Swift' }],
  album: {
    id: 1,
    mid: 'album-mid',
    pmid: '000MkMni19ClKG',
    name: '1989 (Taylor’s Version)',
  },
  pay: { pay_down: 0, pay_month: 1, pay_play: 0, price_track: 0 },
  action: { msgpay: 0 },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Tencent music search', () => {
  it('uses the signed desktop API profile and converts songs to tracks', async () => {
    const request = vi.spyOn(tencentAuth, 'requestSignedApi').mockResolvedValue({
      body: { song: { list: [tencentSong] } },
      meta: { curpage: 1, perpage: 20, sum: 1, nextpage: -1 },
    })

    const tracks = await musicProvider.search('tencent', 'blank space test fixture', 20, 1)

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        comm: { ct: 19, cv: 2201 },
        param: expect.objectContaining({ query: 'blank space test fixture', search_type: 0 }),
      }),
    )
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      source: 'tencent',
      sourceId: '003VHaBb0wCHop',
      title: 'Blank Space',
      artist: ['Taylor Swift'],
      duration: 231,
      cover: 'https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg',
      thumbnailCover: 'https://y.gtimg.cn/music/photo_new/T002R120x120M000000MkMni19ClKG.jpg',
      vip: true,
    })
  })

  it('returns an empty list for malformed upstream song data', async () => {
    vi.spyOn(tencentAuth, 'requestSignedApi').mockResolvedValue({
      body: {},
      meta: { curpage: 1, perpage: 20, sum: 0, nextpage: -1 },
    } as never)

    await expect(musicProvider.search('tencent', 'malformed test fixture', 20, 1)).resolves.toEqual([])
  })

  it('returns an empty list when the signed request fails', async () => {
    vi.spyOn(tencentAuth, 'requestSignedApi').mockRejectedValue(new Error('upstream unavailable'))

    await expect(musicProvider.search('tencent', 'failure test fixture', 20, 1)).resolves.toEqual([])
  })
})

describe('provider cover URL normalization', () => {
  it('removes NetEase size params while preserving other query parameters', () => {
    expect(normalizeNeteaseCoverUrl('https://music.163.com/a.jpg?foo=bar&param=100y100&param=200y200')).toBe(
      'https://music.163.com/a.jpg?foo=bar',
    )
    expect(normalizeNeteaseCoverUrl('https://music.163.com/a.jpg?foo=bar')).toBe('https://music.163.com/a.jpg?foo=bar')
  })

  it('converts documented Kugou size templates to the CDN-safe maximum request', () => {
    expect(normalizeKugouTemplateCoverUrl('http://img.kugou.com/{size}/abc.jpg')).toBe('http://img.kugou.com/5000/abc.jpg')
    expect(normalizeKugouTemplateCoverUrl('http://img.kugou.com/400/abc.jpg')).toBe('http://img.kugou.com/400/abc.jpg')
  })

  it('derives safe provider-specific 120px thumbnail URLs', () => {
    expect(deriveThumbnailCoverUrl('netease', 'https://music.163.com/a.jpg?foo=bar&param=800y800')).toBe(
      'https://music.163.com/a.jpg?foo=bar&param=120y120',
    )
    expect(deriveThumbnailCoverUrl('tencent', 'https://y.gtimg.cn/music/photo_new/T002R800x800M000abc.jpg')).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R120x120M000abc.jpg',
    )
    expect(deriveThumbnailCoverUrl('kugou', 'http://img.kugou.com/{size}/abc.jpg')).toBe('http://img.kugou.com/120/abc.jpg')
    expect(deriveThumbnailCoverUrl('kugou', 'https://example.com/5000/abc.jpg')).toBe('https://example.com/5000/abc.jpg')
  })
})
