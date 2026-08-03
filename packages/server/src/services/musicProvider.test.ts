import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tencentAuth from './tencentAuthService.js'
import { musicProvider } from './musicProvider.js'

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
