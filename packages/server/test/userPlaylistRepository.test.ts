import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import type { Track } from '@music-together/shared'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-user-playlists-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const { userPlaylistRepo } = await import('../src/repositories/playlistRepository.js')
const { userRepo } = await import('../src/repositories/userRepository.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: `Song ${overrides.id}`,
    artist: ['Artist'],
    album: 'Album',
    duration: 200,
    cover: `https://cover/${overrides.id}.jpg`,
    source: 'netease',
    sourceId: overrides.id,
    urlId: overrides.id,
    ...overrides,
  }
}

test('create/list/get are scoped by user_id (ownership isolation)', () => {
  userRepo.ensure('owner-a')
  userRepo.ensure('owner-b')

  const created = userPlaylistRepo.create('owner-a', '我的收藏')
  assert.equal(created.success, true)
  assert.ok(created.success && created.playlist.id)

  // owner-b cannot see owner-a's playlist
  assert.equal(userPlaylistRepo.list('owner-b').length, 0)
  assert.equal(created.success && userPlaylistRepo.get('owner-b', created.playlist.id), null)

  // owner-a sees exactly one
  const listA = userPlaylistRepo.list('owner-a')
  assert.equal(listA.length, 1)
  assert.equal(listA[0]?.name, '我的收藏')
})

test('addTracks dedupes by track id and reports added count', () => {
  userRepo.ensure('dedupe-user')
  const created = userPlaylistRepo.create('dedupe-user', 'Dedupe')
  assert.ok(created.success)
  const id = created.success ? created.playlist.id : ''

  const first = userPlaylistRepo.addTracks('dedupe-user', id, [makeTrack({ id: 't1' }), makeTrack({ id: 't2' })])
  assert.deepEqual(first, { success: true, added: 2, trackCount: 2 })

  // Re-adding t2 plus a new t3: only t3 counts as added
  const second = userPlaylistRepo.addTracks('dedupe-user', id, [makeTrack({ id: 't2' }), makeTrack({ id: 't3' })])
  assert.deepEqual(second, { success: true, added: 1, trackCount: 3 })

  const detail = userPlaylistRepo.get('dedupe-user', id)
  assert.equal(detail?.tracks.length, 3)
  assert.deepEqual(
    detail?.tracks.map((t) => t.id),
    ['t1', 't2', 't3'],
  )
})

test('addTracks strips short-lived streamUrl / proxy / format fields before persisting', () => {
  userRepo.ensure('strip-user')
  const created = userPlaylistRepo.create('strip-user', 'Strip')
  assert.ok(created.success)
  const id = created.success ? created.playlist.id : ''

  userPlaylistRepo.addTracks('strip-user', id, [
    makeTrack({
      id: 's1',
      streamUrl: 'https://short-lived/audio.mp3',
      requiresServerProxy: true,
      streamFormat: 'flac',
    }),
  ])

  const detail = userPlaylistRepo.get('strip-user', id)
  const stored = detail?.tracks[0]
  assert.ok(stored)
  assert.equal(stored?.streamUrl, undefined)
  assert.equal(stored?.requiresServerProxy, undefined)
  assert.equal(stored?.streamFormat, undefined)
  // durable fields survive
  assert.equal(stored?.id, 's1')
  assert.equal(stored?.source, 'netease')
})

test('addTracks caps a playlist at USER_PLAYLIST_TRACKS_MAX', async () => {
  const { LIMITS } = await import('@music-together/shared')
  userRepo.ensure('cap-user')
  const created = userPlaylistRepo.create('cap-user', 'Cap')
  assert.ok(created.success)
  const id = created.success ? created.playlist.id : ''

  const overflow = Array.from({ length: LIMITS.USER_PLAYLIST_TRACKS_MAX + 5 }, (_, i) => makeTrack({ id: `c${i}` }))
  const result = userPlaylistRepo.addTracks('cap-user', id, overflow)
  assert.equal(result.success, true)
  assert.equal(result.success && result.trackCount, LIMITS.USER_PLAYLIST_TRACKS_MAX)
  assert.equal(result.success && result.added, LIMITS.USER_PLAYLIST_TRACKS_MAX)

  // A subsequent add on a full playlist is rejected
  const rejected = userPlaylistRepo.addTracks('cap-user', id, [makeTrack({ id: 'extra' })])
  assert.deepEqual(rejected, { success: false, reason: 'full' })
})

test('cover is derived from the first track when not explicitly set', () => {
  userRepo.ensure('cover-user')
  const created = userPlaylistRepo.create('cover-user', 'Cover')
  assert.ok(created.success)
  const id = created.success ? created.playlist.id : ''
  assert.equal(created.success && created.playlist.cover, null)

  userPlaylistRepo.addTracks('cover-user', id, [
    makeTrack({ id: 'cov1', thumbnailCover: 'https://thumb/cov1.jpg', cover: 'https://full/cov1.jpg' }),
  ])

  const meta = userPlaylistRepo.list('cover-user').find((p) => p.id === id)
  assert.equal(meta?.cover, 'https://thumb/cov1.jpg')
})

test('addTracks / removeTrack refuse playlists owned by another user', () => {
  userRepo.ensure('cross-a')
  userRepo.ensure('cross-b')
  const created = userPlaylistRepo.create('cross-a', 'Cross')
  assert.ok(created.success)
  const id = created.success ? created.playlist.id : ''

  assert.deepEqual(userPlaylistRepo.addTracks('cross-b', id, [makeTrack({ id: 'x1' })]), {
    success: false,
    reason: 'not_found',
  })
  assert.equal(userPlaylistRepo.removeTrack('cross-b', id, 'x1'), false)
  assert.equal(userPlaylistRepo.remove('cross-b', id), false)

  // owner still can
  assert.equal(userPlaylistRepo.addTracks('cross-a', id, [makeTrack({ id: 'x1' })]).success, true)
  assert.equal(userPlaylistRepo.removeTrack('cross-a', id, 'x1'), true)
})

test('create is capped at USER_PLAYLIST_MAX per user', async () => {
  const { LIMITS } = await import('@music-together/shared')
  userRepo.ensure('many-user')
  for (let i = 0; i < LIMITS.USER_PLAYLIST_MAX; i++) {
    assert.equal(userPlaylistRepo.create('many-user', `PL ${i}`).success, true)
  }
  assert.deepEqual(userPlaylistRepo.create('many-user', 'overflow'), { success: false, reason: 'limit_reached' })
})
