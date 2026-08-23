import type { Track } from '@music-together/shared'
import { describe, expect, it, vi } from 'vitest'
import { LyricSupplementService, type LyricSupplementProvider } from './lyricSupplementService.js'

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-id',
    title: '飞云之下',
    artist: ['韩红', '林俊杰'],
    album: '飞云之下',
    duration: 266,
    cover: '',
    source: 'kugou',
    sourceId: 'kugou-hash',
    urlId: 'kugou-hash',
    lyricId: 'kugou-hash',
    ...overrides,
  }
}

function provider(tracks: Track[]): LyricSupplementProvider & {
  search: ReturnType<typeof vi.fn>
  getLyric: ReturnType<typeof vi.fn>
} {
  return {
    search: vi.fn(async () => tracks),
    getLyric: vi.fn(async () => ({
      lyric: '[00:36.46]喔',
      tlyric: '',
      romalrc: '',
      yrc: '',
      wordByWord: [
        {
          words: [{ word: '喔', startTime: 36_466, endTime: 36_833, romanWord: '', obscene: false }],
          translatedLyric: '',
          romanLyric: '',
          startTime: 36_466,
          endTime: 36_833,
          isBG: false,
          isDuet: false,
        },
      ],
    })),
  }
}

const request = {
  source: 'netease' as const,
  lyricId: '554242032',
  title: '飞云之下',
  artists: ['韩红', '林俊杰'],
  duration: 267,
}

describe('LyricSupplementService', () => {
  it('selects only the matching recording before returning KRC timing', async () => {
    const fakeProvider = provider([
      track({ title: '飞云之下 (Live)' }),
      track({ artist: ['韩红'] }),
      track({ duration: 242 }),
      track(),
    ])
    const service = new LyricSupplementService(fakeProvider)

    const result = await service.getSupplement(request)

    expect(result.source).toBe('kugou')
    expect(result.wordByWord?.[0]?.startTime).toBe(36_466)
    expect(fakeProvider.getLyric).toHaveBeenCalledWith('kugou', 'kugou-hash')
  })

  it('deduplicates concurrent enrichment requests for the same track', async () => {
    const fakeProvider = provider([track()])
    const service = new LyricSupplementService(fakeProvider)

    const [first, second] = await Promise.all([service.getSupplement(request), service.getSupplement(request)])

    expect(first).toEqual(second)
    expect(fakeProvider.search).toHaveBeenCalledTimes(1)
    expect(fakeProvider.getLyric).toHaveBeenCalledTimes(1)
  })

  it('falls back to an empty optional result when supplementary providers fail', async () => {
    const fakeProvider = provider([])
    fakeProvider.search.mockRejectedValue(new Error('provider unavailable'))
    const service = new LyricSupplementService(fakeProvider)

    await expect(service.getSupplement(request)).resolves.toEqual({ source: null, lyric: '' })
  })
})
