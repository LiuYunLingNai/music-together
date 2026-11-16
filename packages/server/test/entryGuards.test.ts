import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearJoinPasswordFailures,
  isJoinPasswordLocked,
  recordJoinPasswordFailure,
} from '../src/middleware/socketRateLimiter.js'
import { sanitizeIncomingTrack } from '../src/services/incomingTracks.js'

const socketOf = (identity: string) => ({ id: `s-${identity}`, data: { identityUserId: identity } }) as never

test('同一身份在同一房间连续输错 5 次后锁定，其他房间和身份不受影响，输对后清零', async () => {
  const u1 = socketOf('u1')
  for (let i = 0; i < 4; i++) await recordJoinPasswordFailure(u1, 'r1')
  assert.equal(await isJoinPasswordLocked(u1, 'r1'), false)
  await recordJoinPasswordFailure(u1, 'r1')
  assert.equal(await isJoinPasswordLocked(u1, 'r1'), true)
  assert.equal(await isJoinPasswordLocked(u1, 'r2'), false)
  assert.equal(await isJoinPasswordLocked(socketOf('u2'), 'r1'), false)
  await clearJoinPasswordFailures(u1, 'r1')
  assert.equal(await isJoinPasswordLocked(u1, 'r1'), false)
})

test('入队曲目丢弃客户端播放地址，封面只保留 https', () => {
  const base = { id: 'a', title: 't', artist: [], album: '', duration: 1, source: 'netease', sourceId: '1' }
  const cleaned = sanitizeIncomingTrack({
    ...base,
    streamUrl: 'http://evil.example/x.mp3',
    cover: 'http://p1.music.126.net/a.jpg',
    thumbnailCover: 'javascript:alert(1)',
  } as never) as Record<string, unknown>
  assert.equal('streamUrl' in cleaned, false)
  assert.equal(cleaned.cover, 'https://p1.music.126.net/a.jpg')
  assert.equal('thumbnailCover' in cleaned, false)
  assert.equal((sanitizeIncomingTrack({ ...base, cover: 'http://evil.example/a.jpg' } as never) as { cover: string }).cover, '')
})
