import type { Track } from '@music-together/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const songDynamicCover = vi.fn()
const findBestAlternativeTrack = vi.fn()
const fetchJson = vi.fn()

vi.mock('@neteasecloudmusicapienhanced/api', () => ({
  default: { song_dynamic_cover: (...args: unknown[]) => songDynamicCover(...args) },
}))
vi.mock('./trackFallbackService.js', () => ({
  findBestAlternativeTrack: (...args: unknown[]) => findBestAlternativeTrack(...args),
}))
vi.stubGlobal('fetch', (...args: unknown[]) => fetchJson(...args))
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getDynamicCoverUrl } from './dynamicCoverService.js'
import { logger } from '../utils/logger.js'

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 'dynamic-cover',
  source: 'netease',
  sourceId: '65334',
  urlId: '65334',
  title: 'Song',
  artist: ['Artist'],
  album: 'Album',
  duration: 200,
  cover: '',
  ...overrides,
})

const meta = { title: 'Song', artists: ['Artist'], duration: 200, album: 'Album' }

beforeEach(() => {
  songDynamicCover.mockReset()
  findBestAlternativeTrack.mockReset()
  fetchJson.mockReset()
  fetchJson.mockResolvedValue({ ok: true, json: async () => ({}) })
  findBestAlternativeTrack.mockResolvedValue(null)
})

describe('dynamic cover credentials', () => {
  it('skips the Netease request when the room has no shared account', async () => {
    await expect(getDynamicCoverUrl('netease', '65334', meta)).resolves.toBeNull()
    expect(findBestAlternativeTrack).toHaveBeenCalled()
    expect(songDynamicCover).not.toHaveBeenCalled()
  })

  it('passes the shared account cookie and returns a trusted video URL', async () => {
    songDynamicCover.mockResolvedValue({
      body: { data: { videoPlayUrl: 'http://dcover.music.126.net/obj/video.mp4' } },
    })

    await expect(
      getDynamicCoverUrl('netease', '65335', { ...meta, neteaseCookie: 'session-cookie' }),
    ).resolves.toBe('https://dcover.music.126.net/obj/video.mp4')

    expect(songDynamicCover).toHaveBeenCalledWith({
      id: '65335',
      crypto: 'eapi',
      cookie: 'session-cookie',
    })
  })

  it('treats an expired login as no cover without warning and caches the empty result', async () => {
    songDynamicCover.mockRejectedValue({ status: 301, body: { code: 301 }, cookie: [] })

    await expect(
      getDynamicCoverUrl('netease', '65336', { ...meta, neteaseCookie: 'expired-cookie' }),
    ).resolves.toBeNull()
    await expect(
      getDynamicCoverUrl('netease', '65336', { ...meta, neteaseCookie: 'expired-cookie' }),
    ).resolves.toBeNull()
    expect(songDynamicCover).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('keeps a cross-source Kugou result when matching succeeds', async () => {
    findBestAlternativeTrack.mockImplementation(async (_original: Track, target: string) =>
      target === 'kugou' ? { track: track({ source: 'kugou', urlId: 'kg-hash' }) } : null,
    )
    fetchJson
      .mockResolvedValueOnce({ ok: true, json: async () => ({ album_audio_id: 123 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ dycover: { h264_url: 'http://kgv.stream.tencentmusic.com/v.mp4' } }] }),
      })

    await expect(getDynamicCoverUrl('netease', '65337', meta)).resolves.toBe(
      'https://kgv.stream.tencentmusic.com/v.mp4',
    )
    expect(songDynamicCover).not.toHaveBeenCalled()
  })
})
