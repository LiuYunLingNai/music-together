import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { EVENTS, type Track } from '@music-together/shared'
import type { TypedServer } from '../src/middleware/types.js'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-playback-advance-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const roomService = await import('../src/services/roomService.js')
const playerService = await import('../src/services/playerService.js')
const queueService = await import('../src/services/queueService.js')
const { musicProvider } = await import('../src/services/musicProvider.js')
const { roomRepo } = await import('../src/repositories/roomRepository.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

/** 记录广播出去的事件名，用于断言有没有发出 PLAYER_RESUME */
function createRecordingIo() {
  const emitted: string[] = []
  const io = {
    to: () => ({
      emit: (event: string) => {
        emitted.push(event)
      },
    }),
    emit: (event: string) => {
      emitted.push(event)
    },
    getSocketsInRoom: () => [],
  } as unknown as TypedServer
  return { io, emitted }
}

function track(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `歌曲 ${id}`,
    artist: ['歌手'],
    album: '',
    duration: 180,
    cover: '',
    source: 'netease',
    sourceId: id,
    urlId: id,
    ...overrides,
  }
}

test('ignores resume while already playing so the timeline does not rewind', async () => {
  const { io, emitted } = createRecordingIo()
  const { room } = roomService.createRoom('resume-socket', '房主', '恢复播放', null, 'resume-user')
  const original = musicProvider.getStreamInfoDetailed
  musicProvider.getStreamInfoDetailed = async () => ({
    result: { url: 'https://example.test/audio', requestedQuality: 320, attemptedQuality: 320 },
    failure: null,
  })
  try {
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('a')), true)
    assert.equal(room.playState.isPlaying, true)

    playerService.pauseTrack(io, room.id)
    assert.equal(room.playState.isPlaying, false)
    const pausedAt = room.playState.currentTime
    const revisionAfterPause = room.playState.revision

    assert.equal(playerService.resumeTrack(io, room.id), true)
    assert.equal(room.playState.isPlaying, true)
    const revisionAfterResume = room.playState.revision

    // 第二次恢复必须是无操作：不改 revision，也不广播
    emitted.length = 0
    assert.equal(playerService.resumeTrack(io, room.id), false)
    assert.equal(room.playState.revision, revisionAfterResume)
    assert.ok(!emitted.includes(EVENTS.PLAYER_RESUME))
    assert.ok(revisionAfterResume > revisionAfterPause)
    assert.equal(room.playState.currentTime, pausedAt)
  } finally {
    musicProvider.getStreamInfoDetailed = original
    playerService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('stops playback when every remaining queue track fails to resolve', async () => {
  const { io } = createRecordingIo()
  const { room } = roomService.createRoom('exhaust-socket', '房主', '连续失败', null, 'exhaust-user')
  const original = musicProvider.getStreamInfoDetailed
  musicProvider.getStreamInfoDetailed = async () => ({
    result: { url: 'https://example.test/audio', requestedQuality: 320, attemptedQuality: 320 },
    failure: null,
  })
  try {
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('playing')), true)
    queueService.addTrack(room.id, track('vip-1', { vip: true }))
    queueService.addTrack(room.id, track('vip-2', { vip: true }))

    // 之后的解析全部失败：模拟 VIP 曲目且房间没人登录
    musicProvider.getStreamInfoDetailed = async () => ({
      result: null,
      failure: { reason: 'subscription-required' as const },
    })
    await playerService.playNextTrackInRoom(io, room.id, 'sequential')

    assert.equal(room.playState.isPlaying, false)
    assert.equal(room.currentTrack, null)
  } finally {
    musicProvider.getStreamInfoDetailed = original
    playerService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('drops a next request whose track already finished playing', async () => {
  const { io } = createRecordingIo()
  const { room } = roomService.createRoom('stale-socket', '房主', '过期切歌', null, 'stale-user')
  const original = musicProvider.getStreamInfoDetailed
  musicProvider.getStreamInfoDetailed = async () => ({
    result: { url: 'https://example.test/audio', requestedQuality: 320, attemptedQuality: 320 },
    failure: null,
  })
  try {
    queueService.addTrack(room.id, track('b'))
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('a')), true)

    // 客户端以为还在播 a，但房间已经切到 b
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('b')), true)
    assert.equal(room.currentTrack?.id, 'b')

    await playerService.playNextTrackInRoom(io, room.id, 'sequential', { expectedTrackId: 'a' })
    assert.equal(room.currentTrack?.id, 'b', '指向旧曲目的切歌请求必须被忽略')

    // 不带 expectedTrackId 的旧客户端行为不变
    await playerService.playNextTrackInRoom(io, room.id, 'sequential', { skipDebounce: true })
    assert.notEqual(room.currentTrack?.id, 'b')
  } finally {
    musicProvider.getStreamInfoDetailed = original
    playerService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('keeps queue ids unique so navigation and removal stay addressable', () => {
  const { room } = roomService.createRoom('dup-socket', '房主', '重复 ID', null, 'dup-user')
  try {
    queueService.addTrack(room.id, track('same-id'))
    queueService.addTrack(room.id, track('same-id'))
    queueService.insertAfterCurrent(room.id, track('same-id'))
    queueService.addBatchTracks(room.id, [track('same-id'), track('batch'), track('batch')])

    const ids = room.queue.map((entry) => entry.id)
    assert.equal(ids.length, 6)
    assert.equal(new Set(ids).size, 6, '队列里不允许出现重复 ID')
    // 第一首保留客户端给的 ID，其余换成新 ID
    assert.equal(ids.filter((id) => id === 'same-id').length, 1)
    assert.equal(ids.filter((id) => id === 'batch').length, 1)

    // 删除只命中一条
    queueService.removeTrack(room.id, 'same-id')
    assert.equal(room.queue.length, 5)
    assert.equal(
      room.queue.some((entry) => entry.id === 'same-id'),
      false,
    )
  } finally {
    roomRepo.delete(room.id)
  }
})

async function withConsumedRoom(
  socketId: string,
  run: (ctx: { io: TypedServer; room: ReturnType<typeof roomService.createRoom>['room'] }) => Promise<void>,
) {
  const { io } = createRecordingIo()
  const { room } = roomService.createRoom(socketId, '房主', '消耗队列', null, `${socketId}-user`)
  const original = musicProvider.getStreamInfoDetailed
  musicProvider.getStreamInfoDetailed = async () => ({
    result: { url: 'https://example.test/audio', requestedQuality: 320, attemptedQuality: 320 },
    failure: null,
  })
  try {
    roomService.updateSettings(room.id, { queueMode: 'consume' })
    await run({ io, room })
  } finally {
    musicProvider.getStreamInfoDetailed = original
    playerService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
}

test('a consumed queue drops each track it leaves and never loops back', async () => {
  await withConsumedRoom('consume-socket', async ({ io, room }) => {
    for (const id of ['a', 'b', 'c']) queueService.addTrack(room.id, track(id))
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('a')), true)

    await playerService.playNextTrackInRoom(io, room.id, 'loop-all', { skipDebounce: true })
    assert.equal(room.currentTrack?.id, 'b')
    assert.deepEqual(room.queue.map((t) => t.id), ['b', 'c'])

    await playerService.playNextTrackInRoom(io, room.id, 'loop-all', { skipDebounce: true })
    assert.deepEqual(room.queue.map((t) => t.id), ['c'])

    // The last track has no successor: it leaves too and the room stops instead of wrapping to the start.
    await playerService.playNextTrackInRoom(io, room.id, 'loop-all', { skipDebounce: true })
    assert.equal(room.queue.length, 0)
    assert.equal(room.playState.isPlaying, false)
  })
})

test('a consumed queue comes back to unheard tracks queued before the current one', async () => {
  await withConsumedRoom('consume-back-socket', async ({ io, room }) => {
    for (const id of ['a', 'b', 'c']) queueService.addTrack(room.id, track(id))
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('c')), true)

    await playerService.playNextTrackInRoom(io, room.id, 'sequential', { skipDebounce: true })
    assert.equal(room.currentTrack?.id, 'a')
    assert.deepEqual(room.queue.map((t) => t.id), ['a', 'b'])
  })
})

test('"previous" in a consumed queue restarts the current track', async () => {
  await withConsumedRoom('consume-prev-socket', async ({ io, room }) => {
    queueService.addTrack(room.id, track('a'))
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('a')), true)
    room.playState = { ...room.playState, currentTime: 42 }

    await playerService.playPrevTrackInRoom(io, room.id, { skipDebounce: true })
    assert.equal(room.currentTrack?.id, 'a')
    assert.equal(room.playState.currentTime, 0)
  })
})

test('a room that keeps its queue still holds what was played', async () => {
  const { io } = createRecordingIo()
  const { room } = roomService.createRoom('keep-socket', '房主', '保留队列', null, 'keep-user')
  const original = musicProvider.getStreamInfoDetailed
  musicProvider.getStreamInfoDetailed = async () => ({
    result: { url: 'https://example.test/audio', requestedQuality: 320, attemptedQuality: 320 },
    failure: null,
  })
  try {
    assert.equal(room.queueMode, 'keep')
    for (const id of ['a', 'b']) queueService.addTrack(room.id, track(id))
    assert.equal(await playerService.playTrackInRoom(io, room.id, track('a')), true)
    await playerService.playNextTrackInRoom(io, room.id, 'loop-all', { skipDebounce: true })
    assert.deepEqual(room.queue.map((t) => t.id), ['a', 'b'])
    await playerService.playNextTrackInRoom(io, room.id, 'loop-all', { skipDebounce: true })
    assert.equal(room.currentTrack?.id, 'a')
  } finally {
    musicProvider.getStreamInfoDetailed = original
    playerService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})
