import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import { createHotSongsService, hotSongsPlaylistId } from '../src/services/hotSongsService.js'

function makeTrack(index: number): Track {
  return {
    id: `track-${index}`,
    title: `歌曲 ${index}`,
    artist: ['歌手'],
    album: '热歌榜',
    duration: 180,
    cover: '',
    source: 'netease',
    sourceId: String(index),
    urlId: String(index),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('loads up to 500 tracks from the official Netease hot playlist', async () => {
  const calls: unknown[][] = []
  const tracks = Array.from({ length: 200 }, (_, index) => makeTrack(index + 1))
  const service = createHotSongsService({
    async getPlaylistPage(...args) {
      calls.push(args)
      return { tracks }
    },
  })

  const result = await service.getHotSongs('netease', 30)
  assert.equal(result.tracks.length, 30)
  assert.equal(result.total, 200)
  assert.equal(result.hasMore, true)
  assert.deepEqual(calls[0], ['netease', hotSongsPlaylistId, 500, 0, undefined, null, 'playlist'])
})

test('returns 30-track pages from the cached chart', async () => {
  const tracks = Array.from({ length: 65 }, (_, index) => makeTrack(index + 1))
  const service = createHotSongsService({ async getPlaylistPage() { return { tracks } } })

  const first = await service.getHotSongs('netease', 30, 0)
  const second = await service.getHotSongs('netease', 30, 30)
  const third = await service.getHotSongs('netease', 30, 60)

  assert.equal(first.tracks[0]?.sourceId, '1')
  assert.equal(second.tracks[0]?.sourceId, '31')
  assert.equal(third.tracks.length, 5)
  assert.equal(third.hasMore, false)
})

test('parses the QQ official hot chart and falls back to album artwork after the top three', async () => {
  let requestBody: Record<string, unknown> | undefined
  const fetchMock: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return jsonResponse({
      toplist: {
        data: {
          data: {
            song: [
              { songId: 1, title: '热歌', singerName: '歌手', albumMid: 'album', cover: 'https://cover' },
              { songId: 2, title: '第四名', singerName: '歌手', albumMid: 'album-fallback', cover: '' },
            ],
          },
          songInfoList: [
            {
              mid: 'song-mid',
              name: '热歌',
              interval: 210,
              singer: [{ name: '歌手' }],
              album: { mid: 'album', name: '专辑' },
            },
            {
              mid: 'song-mid-2',
              name: '第四名',
              interval: 180,
              singer: [{ name: '歌手' }],
              album: { mid: 'album-fallback', pmid: 'album-fallback_2', name: '专辑' },
            },
          ],
        },
      },
    })
  }
  const service = createHotSongsService({ async getPlaylistPage() { return { tracks: [] } } }, Date.now, fetchMock)

  const { tracks } = await service.getHotSongs('tencent', 30)
  assert.equal(tracks[0]?.source, 'tencent')
  assert.equal(tracks[0]?.sourceId, 'song-mid')
  assert.equal(tracks[0]?.cover, 'https://cover')
  assert.equal(
    tracks[1]?.cover,
    'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-fallback_2.jpg',
  )
  assert.equal(
    ((requestBody?.toplist as Record<string, unknown>).param as Record<string, unknown>).num,
    300,
  )
})

test('parses the Kugou TOP500 response and normalizes its cover', async () => {
  let requestedUrl = ''
  const fetchMock: typeof fetch = async (input) => {
    requestedUrl = String(input)
    return jsonResponse({
      status: 1,
      data: {
        info: [
          {
            hash: 'ABC',
            filename: '歌手 - 酷狗热歌',
            duration: 180,
            trans_param: { union_cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg' },
          },
        ],
      },
    })
  }
  const service = createHotSongsService({ async getPlaylistPage() { return { tracks: [] } } }, Date.now, fetchMock)

  const { tracks } = await service.getHotSongs('kugou', 30)
  assert.match(requestedUrl, /rankid=8888/)
  assert.match(requestedUrl, /pagesize=500/)
  assert.equal(tracks[0]?.source, 'kugou')
  assert.equal(tracks[0]?.title, '酷狗热歌')
  assert.equal(tracks[0]?.cover, 'https://imgessl.kugou.com/stdmusic/400/cover.jpg')
})

test('caches and coalesces requests independently for each platform', async () => {
  let now = 1_000
  let neteaseCalls = 0
  let fetchCalls = 0
  const service = createHotSongsService(
    {
      async getPlaylistPage() {
        neteaseCalls += 1
        return { tracks: [makeTrack(1), makeTrack(2)] }
      },
    },
    () => now,
    async () => {
      fetchCalls += 1
      return jsonResponse({
        toplist: { data: { data: { song: [{ songId: 1 }] }, songInfoList: [{ mid: 'qq-1', name: 'QQ 热歌' }] } },
      })
    },
  )

  const [first, second] = await Promise.all([
    service.getHotSongs('netease', 1),
    service.getHotSongs('netease', 2),
  ])
  assert.equal(first.tracks.length, 1)
  assert.equal(second.tracks.length, 2)
  await service.getHotSongs('tencent', 1)
  await service.getHotSongs('tencent', 1)
  assert.equal(neteaseCalls, 1)
  assert.equal(fetchCalls, 1)

  now += 3 * 60 * 60 * 1000 + 1
  await service.getHotSongs('netease', 1)
  assert.equal(neteaseCalls, 2)
})

test('force refresh bypasses cached data and empty results are not cached', async () => {
  let calls = 0
  const service = createHotSongsService({
    async getPlaylistPage() {
      calls += 1
      if (calls === 2) return { tracks: [] }
      return { tracks: [makeTrack(calls)] }
    },
  })

  assert.equal((await service.getHotSongs('netease', 1)).tracks[0]?.sourceId, '1')
  await assert.rejects(() => service.getHotSongs('netease', 1, 0, true), /返回空结果/)
  assert.equal((await service.getHotSongs('netease', 1, 0, true)).tracks[0]?.sourceId, '3')
})
