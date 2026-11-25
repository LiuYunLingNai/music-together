import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

process.env.LOG_LEVEL = 'silent'
process.env.QQ_MUSIC_API_URL = 'https://obsolete.invalid/api'
process.env.QQ_MUSIC_API_KEY = randomUUID()

const { musicProvider } = await import('../src/services/musicProvider.js')
const { SearchError } = await import('../src/services/catalogUtils.js')
const { rawToTrack } = await import('../src/services/trackMapping.js')

function pageWith(list: unknown[]) {
  return { code: 0, music: { code: 0, data: { body: { song: { list } } } } }
}

test('uses QQ desktop search directly, forwards pagination and keeps playable track metadata', async (context) => {
  const upstream = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      pageWith([
        null,
        { mid: ' ' },
        {
          mid: 'song-a',
          name: 'Song',
          title: 'Song (Live)',
          interval: 215,
          singer: [{ name: 'First' }, {}, { name: 'Second' }],
          album: { mid: 'album-a', pmid: 'alt-art', name: 'Album' },
          pay: { pay_month: 1 },
        },
        { mid: 'song-b', title: 'Another', album: { pmid: 'album-b', title: 'Other album' } },
      ]),
    ),
  )
  const keyword = '歌曲 & live'
  const tracks = await musicProvider.search('tencent', keyword, 2, 3)
  assert.equal(upstream.mock.callCount(), 1)
  const [url, init] = upstream.mock.calls[0].arguments
  assert.equal(String(url), 'https://u.y.qq.com/cgi-bin/musicu.fcg')
  assert.equal(init?.method, 'POST')
  assert.equal(init?.redirect, 'error')
  assert.ok(init?.signal instanceof AbortSignal)
  const headers = new Headers(init?.headers)
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.has('cookie'), false)
  assert.equal(headers.has('x-api-key'), false)
  assert.deepEqual(JSON.parse(String(init?.body)), {
    comm: { ct: '19', cv: '1910' },
    music: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { grp: 1, num_per_page: 2, page_num: 3, query: keyword },
    },
  })
  assert.equal(tracks.length, 2)
  const [first, second] = tracks
  assert.deepEqual(first, {
    id: first.id,
    source: 'tencent',
    sourceId: 'song-a',
    urlId: 'song-a',
    lyricId: 'song-a',
    title: 'Song',
    artist: ['First', 'Second'],
    album: 'Album',
    duration: 215,
    vip: true,
    picId: 'album-a',
    cover: 'https://y.gtimg.cn/music/photo_new/T002R800x800M000album-a.jpg',
    thumbnailCover: 'https://y.gtimg.cn/music/photo_new/T002R120x120M000album-a.jpg',
    lyricAliases: { title: 'Song (Live)' },
  })
  assert.equal(second.title, 'Another')
  assert.equal(second.album, 'Other album')
  assert.equal(second.picId, 'album-b')
  assert.deepEqual(second.artist, ['Unknown'])
  assert.equal(second.vip, false)
})

test('returns QQ search intervals in whole seconds for numeric and text fields', async (context) => {
  const intervals = [215, ' 182 ', 0, '0', undefined, null, -1, 1.5, '', '12s', '1e2', true, '4294967296']
  const songs = intervals.map((interval, index) => ({ mid: `duration-${index}`, interval }))
  const upstream = context.mock.method(globalThis, 'fetch', async () => Response.json(pageWith(songs)))

  const tracks = await musicProvider.search('tencent', 'duration-formats')
  assert.deepEqual(
    tracks.map((track) => track.duration),
    [215, 182, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  )
  assert.equal(upstream.mock.callCount(), 1)
})

test('fills missing search durations from known QQ metadata only for the same MID, even on the first search', async (context) => {
  musicProvider.ingest([rawToTrack({ mid: 'known-length', name: 'Song', interval: ' 198 ' }, 'tencent')])
  const songs = [
    { mid: 'known-length', name: 'Song' },
    { mid: 'other-version', name: 'Song' },
  ]
  const upstream = context.mock.method(globalThis, 'fetch', async () => Response.json(pageWith(songs)))
  const durations = async () => (await musicProvider.search('tencent', 'known-lengths')).map((track) => track.duration)

  assert.deepEqual(await durations(), [198, 0])
  assert.deepEqual(await durations(), [198, 0])
  assert.equal(upstream.mock.callCount(), 1)
})

test('sends only the QQ search credential and scopes cached pages to the requester', async (context) => {
  const firstKey = randomUUID()
  const secondKey = randomUUID()
  const firstCookie = `qqmusic_uin=o0101; qqmusic_key=${firstKey}; refresh_token=${randomUUID()}`
  const secondCookie = `musicid=102; musickey=${secondKey}`
  let calls = 0
  const upstream = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(pageWith([{ mid: `result-${++calls}` }])),
  )
  const search = async (cookie?: string, page = 1) =>
    (await musicProvider.search('tencent', 'scope', 10, page, cookie)).map((track) => track.sourceId)

  assert.deepEqual(await search(firstCookie), ['result-1'])
  assert.deepEqual(await search(), ['result-2'])
  assert.deepEqual(await search(secondCookie), ['result-3'])
  assert.deepEqual(await search(firstCookie, 2), ['result-4'])
  assert.deepEqual(await search(firstCookie), ['result-1'])
  assert.deepEqual(await search(), ['result-2'])
  assert.deepEqual(await search(secondCookie), ['result-3'])
  const cookies = upstream.mock.calls.map(({ arguments: [, init] }) => new Headers(init?.headers).get('cookie'))
  assert.deepEqual(cookies, [
    `uin=101; qm_keyst=${firstKey}`,
    null,
    `uin=102; qm_keyst=${secondKey}`,
    `uin=101; qm_keyst=${firstKey}`,
  ])
})

test('skips blank queries and accepts a successful empty QQ page', async (context) => {
  const upstream = context.mock.method(globalThis, 'fetch', async () => Response.json(pageWith([])))
  assert.deepEqual(await musicProvider.search('tencent', '   '), [])
  assert.equal(upstream.mock.callCount(), 0)
  assert.deepEqual(await musicProvider.search('tencent', 'no-matches'), [])
  assert.equal(upstream.mock.callCount(), 1)
})

const failures = {
  'HTTP rate limit': () => Response.json(pageWith([]), { status: 429 }),
  'global rejection': () => Response.json({ ...pageWith([]), code: 1 }),
  'search rejection': () => Response.json({ music: { code: 1 } }),
  'missing song list': () => Response.json({ music: { code: 0, data: {} } }),
  'unusable song list': () => Response.json(pageWith([null, { mid: '' }])),
  'invalid JSON': () => new Response('<html>'),
  timeout: () => {
    throw new DOMException('Timed out', 'TimeoutError')
  },
}
for (const [label, fail] of Object.entries(failures)) {
  test(`QQ ${label} is a retryable search failure, not an empty page`, async (context) => {
    const upstream = context.mock.method(globalThis, 'fetch', async () => fail())
    await assert.rejects(
      musicProvider.search('tencent', label),
      (error) => error instanceof SearchError && error.status === 503,
    )
    upstream.mock.mockImplementation(async () => Response.json(pageWith([{ mid: 'recovered' }])))
    const tracks = await musicProvider.search('tencent', label)
    assert.equal(tracks[0]?.sourceId, 'recovered')
  })
}
