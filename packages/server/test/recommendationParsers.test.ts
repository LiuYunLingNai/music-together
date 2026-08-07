import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBilibiliRecommendedVideos } from '../src/services/bilibiliAuthService.js'
import {
  getConceptPlaylistTracks,
  getPlaylistTracks,
  parseKugouRecommendationSongs,
} from '../src/services/kugouAuthService.js'
import {
  getRadarRecommendations as getTencentRadarRecommendations,
  getRecommendedPlaylistPage as getTencentRecommendedPlaylistPage,
} from '../src/services/tencentAuthService.js'
import {
  parseKugouRecommendedPlaylists,
  parseNeteaseRecommendedPlaylists,
  parseTencentRadarRecommendationPage,
  parseTencentRecommendedPlaylistPage,
  parseTencentRecommendedPlaylists,
} from '../src/services/recommendationParsers.js'

test('parses and deduplicates Tencent recommended playlists', () => {
  const playlists = parseTencentRecommendedPlaylists({
    List: [
      {
        Playlist: {
          basic: {
            tid: 123,
            title: 'Daily mix',
            cover: { default_url: 'https://example.test/tencent.jpg' },
            song_cnt: 42,
            creator: { nick: 'QQ editor' },
            desc: 'Recommended for you',
          },
        },
      },
      { Playlist: { basic: { tid: 123, title: 'Duplicate' } } },
      { Playlist: { basic: { tid: '', title: 'Missing id' } } },
      { Playlist: { basic: { id: 456 } } },
    ],
  })

  assert.deepEqual(playlists, [
    {
      id: '123',
      name: 'Daily mix',
      cover: 'https://example.test/tencent.jpg',
      trackCount: 42,
      creator: 'QQ editor',
      description: 'Recommended for you',
      source: 'tencent',
    },
    {
      id: '456',
      name: 'Untitled playlist',
      cover: '',
      trackCount: 0,
      creator: '',
      description: '',
      source: 'tencent',
    },
  ])
})

test('parses Tencent recommendation playlist pagination', () => {
  const page = parseTencentRecommendedPlaylistPage({
    List: [{ Playlist: { basic: { tid: 123, title: 'Page result' } } }],
    HasMore: 1,
    FromLimit: 25,
  })

  assert.equal(page.playlists[0]?.id, '123')
  assert.equal(page.hasMore, true)
  assert.equal(page.fromLimit, 25)
})

test('parses and deduplicates Tencent radar songs', () => {
  const page = parseTencentRadarRecommendationPage({
    VecSongs: [
      { Track: { mid: 'song-1', name: 'Radar song' } },
      { Track: { mid: 'song-1', name: 'Duplicate' } },
      { Track: { name: 'Missing MID' } },
      { Track: { songmid: 'song-2', name: 'Fallback MID' } },
    ],
    HasMore: true,
  })

  assert.deepEqual(
    page.songs.map((song) => song.mid ?? song.songmid),
    ['song-1', 'song-2'],
  )
  assert.equal(page.hasMore, true)
})

test('maps NetEase recommend_resource playlists', () => {
  const playlists = parseNeteaseRecommendedPlaylists({
    body: {
      recommend: [
        {
          id: 987,
          name: 'Private radar',
          picUrl: 'https://example.test/netease.jpg',
          trackCount: 30,
          creator: { nickname: 'Cloud editor' },
          copywriter: 'Based on your listening',
        },
      ],
    },
  })

  assert.deepEqual(playlists, [
    {
      id: '987',
      name: 'Private radar',
      cover: 'https://example.test/netease.jpg',
      trackCount: 30,
      creator: 'Cloud editor',
      description: 'Based on your listening',
      source: 'netease',
    },
  ])
})

test('maps standard and concept Kugou recommended playlists', () => {
  const response = {
    data: {
      special_list: [
        {
          global_collection_id: 'global-123',
          specialid: 123,
          specialname: 'Curated hits',
          imgurl: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
          songcount: 25,
          nickname: 'Kugou editor',
          intro: 'A playlist description',
        },
        {
          specialid: 456,
          specialname: 'Fallback id',
          flexible_cover: '//imge.kugou.com/stdmusic/{size}/fallback.jpg',
        },
        { specialname: 'Missing id' },
      ],
    },
  }

  const standard = parseKugouRecommendedPlaylists(response, 'kugou')
  const concept = parseKugouRecommendedPlaylists(response, 'kugou_concept')

  assert.equal(standard.length, 2)
  assert.deepEqual(standard[0], {
    id: 'global-123',
    name: 'Curated hits',
    cover: 'https://imgessl.kugou.com/stdmusic/400/cover.jpg',
    trackCount: 25,
    creator: 'Kugou editor',
    description: 'A playlist description',
    source: 'kugou',
  })
  assert.equal(standard[1]?.id, '456')
  assert.equal(standard[1]?.cover, 'https://imgessl.kugou.com/stdmusic/400/fallback.jpg')
  assert.deepEqual(
    concept.map((playlist) => playlist.source),
    ['kugou_concept', 'kugou_concept'],
  )
})

test('finds unique Kugou recommendation playlist IDs', () => {
  const playlists = parseKugouRecommendedPlaylists(
    {
      data: {
        special_list: [
          { global_collection_id: 'global-123', specialid: 123 },
          { specialid: 456 },
          { global_collection_id: 'global-123' },
          {},
        ],
      },
    },
    'kugou',
  )
  assert.deepEqual(
    playlists.map((playlist) => playlist.id),
    ['global-123', '456'],
  )
})

test('finds Kugou recommendation songs in nested response data', () => {
  const songs = parseKugouRecommendationSongs({ data: { song_list: [{ hash: 'abc123', filename: 'Song' }] } })
  assert.deepEqual(songs, [{ hash: 'abc123', filename: 'Song' }])
})

test('builds an unsigned Tencent Web recommendation request', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(
      JSON.stringify({
        req: {
          code: 0,
          data: {
            List: [{ Playlist: { basic: { tid: 321, title: 'Request result' } } }],
            HasMore: 1,
            FromLimit: 36,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const page = await getTencentRecommendedPlaylistPage('uin=12345; qm_keyst=test-key', 12, 24)
    assert.equal(page.playlists[0]?.id, '321')
    assert.equal(page.hasMore, true)
    assert.equal(page.nextOffset, 36)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestUrl, 'https://u.y.qq.com/cgi-bin/musicu.fcg')
  assert.equal(new URL(requestUrl).searchParams.has('sign'), false)
  assert.equal(new Headers(requestInit?.headers).get('Cookie'), 'uin=12345; qm_keyst=test-key')

  const payload = JSON.parse(String(requestInit?.body)) as {
    comm: Record<string, unknown>
    req: { module: string; method: string; param: Record<string, unknown> }
  }
  assert.equal(payload.req.module, 'music.playlist.PlaylistSquare')
  assert.equal(payload.req.method, 'GetRecommendFeed')
  assert.deepEqual(payload.req.param, { From: 24, Size: 12 })
  assert.equal(payload.comm.uin, 12345)
  assert.equal(payload.comm.platform, 'yqq.json')
  assert.equal(payload.comm.need_new_code, 1)
  assert.equal(payload.comm.g_tk, payload.comm.g_tk_new_20200303)
  assert.notEqual(payload.comm.g_tk, 5381)
})

test('builds an unsigned Tencent radar pagination request', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(
      JSON.stringify({
        req: {
          code: 0,
          data: {
            VecSongs: [{ Track: { mid: 'radar-1', name: 'Radar result' } }],
            HasMore: 1,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const page = await getTencentRadarRecommendations('uin=12345; qm_keyst=test-key', 3)
    assert.equal(page.songs[0]?.mid, 'radar-1')
    assert.equal(page.hasMore, true)
    assert.equal(page.nextPage, 4)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestUrl, 'https://u.y.qq.com/cgi-bin/musicu.fcg')
  assert.equal(new URL(requestUrl).searchParams.has('sign'), false)
  const payload = JSON.parse(String(requestInit?.body)) as {
    req: { module: string; method: string; param: Record<string, unknown> }
  }
  assert.equal(payload.req.module, 'music.recommend.TrackRelationServer')
  assert.equal(payload.req.method, 'GetRadarSong')
  assert.deepEqual(payload.req.param, {
    Page: 3,
    ReqType: 0,
    FavSongs: [],
    EntranceSongs: [],
  })
})

test('passes recommended Kugou global collection IDs to both detail loaders', async () => {
  const originalFetch = globalThis.fetch
  const requestUrls: string[] = []

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestUrls.push(String(input))
    return new Response(
      JSON.stringify({ status: 1, data: { songs: [{ hash: 'abc', filename: 'Track' }], count: 1 } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }) as typeof fetch

  try {
    const standard = await getPlaylistTracks('global-standard', 1, 50, 'userid=1; token=token')
    const concept = await getConceptPlaylistTracks('global-concept', 1, 50, 'userid=1; token=token')
    assert.equal(standard.songs.length, 1)
    assert.equal(concept.songs.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(new URL(requestUrls[0]!).searchParams.get('global_collection_id'), 'global-standard')
  assert.equal(new URL(requestUrls[1]!).searchParams.get('global_collection_id'), 'global-concept')
})

test('filters and normalizes Bilibili recommendation videos', () => {
  const videos = parseBilibiliRecommendedVideos({
    item: [
      {
        goto: 'av',
        bvid: 'BV1xx',
        title: '推荐视频',
        owner: { name: 'UP主' },
        duration: 123,
        pic: '//image.test/cover',
      },
      { goto: 'live', bvid: 'BV2xx', title: '直播' },
      { goto: 'av', title: '缺少 BV 号' },
    ],
  })
  assert.deepEqual(videos, [
    { bvid: 'BV1xx', title: '推荐视频', author: 'UP主', duration: 123, cover: 'https://image.test/cover' },
  ])
})
