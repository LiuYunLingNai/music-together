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
    expect(fakeProvider.search).toHaveBeenCalledTimes(2)
    expect(fakeProvider.getLyric).toHaveBeenCalledTimes(2)
  })

  it('uses an exactly matched Netease YRC for a Tencent track without word timing', async () => {
    const neteaseTrack = track({
      source: 'netease',
      sourceId: '1901371647',
      lyricId: '1901371647',
      title: '孤勇者',
      artist: ['陈奕迅'],
      duration: 256,
    })
    const fakeProvider: LyricSupplementProvider = {
      search: vi.fn(async (source) => (source === 'netease' ? [neteaseTrack] : [])),
      getLyric: vi.fn(async () => ({
        lyric: '[00:00.00]都 是勇敢的',
        tlyric: '',
        romalrc: '',
        yrc: '[0,1000](0,300,0)都(300,300,0)是(600,400,0)勇敢的',
      })),
    }
    const service = new LyricSupplementService(fakeProvider)

    const result = await service.getSupplement({
      source: 'tencent',
      lyricId: '003UkWuI0E8U0l',
      title: '孤勇者',
      artists: ['陈奕迅'],
      duration: 256,
    })

    expect(result.source).toBe('netease')
    expect(result.yrc).toContain('(300,300,0)是')
    expect(fakeProvider.getLyric).toHaveBeenCalledWith('netease', '1901371647')
  })

  it('retries with the platform alias title when the display name finds nothing', async () => {
    const searched: string[] = []
    const fakeProvider = provider([])
    fakeProvider.search.mockImplementation(async (_source: string, keyword: string) => {
      searched.push(keyword)
      return keyword.startsWith('Yoru ni Kakeru')
        ? [track({ title: 'Yoru ni Kakeru', artist: ['YOASOBI'], album: 'THE BOOK', duration: 261 })]
        : []
    })
    const service = new LyricSupplementService(fakeProvider)

    const result = await service.getSupplement({
      source: 'netease',
      lyricId: '123',
      title: '向夜晚奔去',
      artists: ['YOASOBI'],
      duration: 261,
      originalTitle: 'Yoru ni Kakeru',
    })

    expect(result.source).not.toBeNull()
    expect(searched).toContain('向夜晚奔去 YOASOBI')
    expect(searched).toContain('Yoru ni Kakeru YOASOBI')
  })

  it('does not retry with an alias title that marks an instrumental version', async () => {
    const fakeProvider = provider([])
    const service = new LyricSupplementService(fakeProvider)

    await service.getSupplement({
      source: 'netease',
      lyricId: '123',
      title: '飞云之下 (伴奏)',
      artists: ['韩红'],
      duration: 267,
      originalTitle: '飞云之下',
    })

    expect(fakeProvider.search.mock.calls.map((call) => call[1])).not.toContain('飞云之下 韩红')
  })

  it('falls back to an empty optional result when supplementary providers fail', async () => {
    const fakeProvider = provider([])
    fakeProvider.search.mockRejectedValue(new Error('provider unavailable'))
    const service = new LyricSupplementService(fakeProvider)

    await expect(service.getSupplement(request)).resolves.toEqual({
      source: null,
      lyric: '',
      lyricId: '',
      title: '',
      artist: [],
      duration: 0,
    })
  })
})
