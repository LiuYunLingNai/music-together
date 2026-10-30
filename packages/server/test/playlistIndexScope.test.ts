import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import type { Track } from '@music-together/shared'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-playlist-index-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { musicProvider, playlistIndexKey } = await import('../src/services/musicProvider.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

// 访问私有成员只为把上游歌单接口换成桩，测试不依赖线上平台
interface ProviderInternals {
  registerTracks(tracks: Track[]): void
  playlistIndex: { set(key: string, value: { source: 'tencent'; ids: string[] }): void }
  fetchTencentPlaylist(playlistId: string, cacheKey: string, cookie?: string | null): Promise<{ ids: string[]; total: number }>
}
const internals = musicProvider as unknown as ProviderInternals

function makeTrack(sourceId: string): Track {
  return {
    id: sourceId,
    title: `歌曲 ${sourceId}`,
    artist: ['歌手'],
    album: '专辑',
    duration: 180,
    cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000test.jpg',
    source: 'tencent',
    sourceId,
    urlId: sourceId,
  }
}

test('keys cookie-backed playlist results by credential', () => {
  const anonymous = playlistIndexKey('tencent', 'playlist', '201')
  assert.equal(anonymous, 'tencent:playlist:201')
  assert.equal(playlistIndexKey('tencent', 'playlist', '201', null), anonymous)

  const first = playlistIndexKey('tencent', 'playlist', '201', 'uin=1; qm_keyst=first')
  const second = playlistIndexKey('tencent', 'playlist', '201', 'uin=2; qm_keyst=second')
  assert.notEqual(first, anonymous)
  assert.notEqual(first, second)
  assert.equal(first, playlistIndexKey('tencent', 'playlist', '201', 'uin=1; qm_keyst=first'))
  assert.ok(!first.includes('qm_keyst'), 'the key must not embed the raw cookie')
})

test('does not serve one account\'s private playlist to other requesters', async () => {
  const calls: Array<string | null | undefined> = []
  const original = internals.fetchTencentPlaylist
  internals.fetchTencentPlaylist = async function (this: ProviderInternals, _playlistId, cacheKey, cookie) {
    calls.push(cookie)
    const tracks = cookie === 'owner-cookie' ? [makeTrack('private-a'), makeTrack('private-b')] : [makeTrack('other')]
    this.registerTracks(tracks)
    this.playlistIndex.set(cacheKey, { source: 'tencent', ids: tracks.map((track) => track.sourceId) })
    return { ids: tracks.map((track) => track.sourceId), total: tracks.length }
  }

  try {
    const owner = await musicProvider.getPlaylistPage('tencent', 'scope-test', 50, 0, undefined, 'owner-cookie')
    assert.deepEqual(owner.tracks.map((track) => track.sourceId), ['private-a', 'private-b'])

    const anonymous = await musicProvider.getPlaylistPage('tencent', 'scope-test', 50, 0, undefined, null)
    assert.deepEqual(anonymous.tracks.map((track) => track.sourceId), ['other'])

    const otherAccount = await musicProvider.getPlaylistPage('tencent', 'scope-test', 50, 0, undefined, 'other-cookie')
    assert.deepEqual(otherAccount.tracks.map((track) => track.sourceId), ['other'])

    const ownerAgain = await musicProvider.getPlaylistPage('tencent', 'scope-test', 50, 0, undefined, 'owner-cookie')
    assert.deepEqual(ownerAgain.tracks.map((track) => track.sourceId), ['private-a', 'private-b'])

    // 第四次命中了属主自己的缓存，没有再请求上游
    assert.deepEqual(calls, ['owner-cookie', null, 'other-cookie'])
  } finally {
    internals.fetchTencentPlaylist = original
  }
})
