import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import { ArtistError, createArtistService, type ArtistNcm } from '../src/services/artistService.js'
import { createDiscoverService, DiscoverError, type DiscoverNcm } from '../src/services/discoverService.js'
import { parseNeteaseTrack } from '../src/services/neteaseTrackParser.js'

const ok = (body: Record<string, unknown>) => Promise.resolve({ body: { code: 200, ...body } })

function artistNcm(overrides: Partial<ArtistNcm> = {}): ArtistNcm {
  return {
    artists: () => ok({ artist: { id: 6452, name: '周杰伦', picUrl: 'http://p1.music.126.net/a.jpg', briefDesc: '简介' } }),
    artist_songs: () => ok({ songs: [{ id: 1 }], more: true, total: 300 }),
    artist_album: () => ok({ hotAlbums: [{ id: 9, name: '范特西', size: 10, artist: { name: '周杰伦' } }], more: false }),
    ...overrides,
  }
}

const ingest = (songs: unknown): Track[] =>
  (songs as { id: number }[]).map((song) => ({
    id: String(song.id),
    title: '',
    artist: [],
    album: '',
    duration: 0,
    cover: '',
    source: 'netease',
    sourceId: String(song.id),
    urlId: String(song.id),
  }))

test('artist home combines profile, hottest songs and albums and shares concurrent loads', async () => {
  let profileCalls = 0
  const service = createArtistService({
    ncm: artistNcm({
      artists: () => {
        profileCalls += 1
        return ok({ artist: { id: 6452, name: '周杰伦', picUrl: 'http://p1.music.126.net/a.jpg', briefDesc: '简介' } })
      },
    }),
    ingestSongs: ingest,
  })
  const [home] = await Promise.all([service.getArtist('netease', '6452'), service.getArtist('netease', '6452')])
  assert.equal(profileCalls, 1)
  assert.equal(home.artist.name, '周杰伦')
  assert.equal(home.artist.description, '简介')
  assert.ok(home.artist.cover.startsWith('https://'))
  assert.deepEqual(home.songs, { items: ingest([{ id: 1 }]), hasMore: true, total: 300 })
  assert.equal(home.albums.items[0]?.creator, '周杰伦')
})

test('artist service rejects unsupported platforms and maps upstream failures to 503', async () => {
  const unsupported = createArtistService({ ncm: artistNcm(), ingestSongs: ingest })
  await assert.rejects(unsupported.getArtist('tencent', '1'), (error: unknown) => {
    return error instanceof ArtistError && error.status === 400
  })

  const failing = createArtistService({
    ncm: artistNcm({ artist_songs: () => Promise.resolve({ body: { code: 500 } }) }),
    ingestSongs: ingest,
  })
  await assert.rejects(failing.getSongs('netease', '1', 0, 50), (error: unknown) => {
    return error instanceof ArtistError && error.status === 503 && error.code === 'ARTIST_UPSTREAM'
  })

  const slow = createArtistService({
    ncm: artistNcm({ artist_album: () => new Promise(() => {}) }),
    ingestSongs: ingest,
    timeoutMs: 5,
  })
  await assert.rejects(slow.getAlbums('netease', '1', 0, 30), (error: unknown) => error instanceof ArtistError)
})

test('discover home keeps loaded blocks when another block fails', async () => {
  const ncm: DiscoverNcm = {
    playlist_detail: ({ id }) => ok({ playlist: { id, name: `雷达 ${id}`, trackCount: 30 } }),
    top_artists: () => Promise.reject(new Error('network')),
    album_new: () => ok({ albums: [{ id: 2, name: '新碟' }] }),
  }
  const home = await createDiscoverService({ ncm }).getHome('netease')
  assert.equal(home.radar.length, 7)
  assert.deepEqual(home.artists, [])
  assert.equal(home.albums[0]?.name, '新碟')
  assert.deepEqual(home.failed, ['artists'])

  await assert.rejects(createDiscoverService({ ncm }).getHome('kugou'), (error: unknown) => {
    return error instanceof DiscoverError && error.status === 400
  })
})

test('NetEase tracks carry artist ids aligned with names', () => {
  const track = parseNeteaseTrack({ id: 1, name: '晴天', ar: [{ id: 6452, name: '周杰伦' }, { id: 0, name: '' }] })
  assert.deepEqual(track.artist, ['周杰伦'])
  assert.deepEqual(track.artistIds, ['6452'])
  const withoutIds = parseNeteaseTrack({ id: 2, name: 'x', ar: [{ name: '无名' }] })
  assert.equal(withoutIds.artistIds, undefined)
})
