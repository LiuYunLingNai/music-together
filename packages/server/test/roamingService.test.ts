import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import type { RoomData } from '../src/repositories/types.js'
import {
  createRoamingService,
  ROAMING_REQUESTER_LABEL,
  shouldPreferRoamingForNext,
} from '../src/services/roamingService.js'
import { parseNeteaseTrack } from '../src/services/neteaseTrackParser.js'

const track = (sourceId: string): Track => ({
  id: `id-${sourceId}`,
  title: sourceId,
  artist: ['artist'],
  album: '',
  duration: 180,
  cover: '',
  source: 'netease',
  sourceId,
  urlId: sourceId,
})

const room = (overrides: Partial<RoomData> = {}): RoomData => ({
  id: 'room', name: 'room', password: null, creatorId: 'owner', hostId: 'owner', adminUserIds: new Set(),
  temporaryAdminUserId: null, allowTemporaryAdminTrackRemoval: false, allowTemporaryAdminQueueClear: false,
  removePlayedTracks: false,
  roamingEnabled: true, roamingSource: 'netease', roamingMode: 'DEFAULT', hidden: false, permanent: false, audioQuality: 320,
  members: [], users: [], queue: [], currentTrack: null,
  playState: { isPlaying: false, currentTime: 0, serverTimestamp: 0 }, playMode: 'sequential', ...overrides,
})

test('uses only the room creator cookie and labels the selected song', async () => {
  const calls: string[] = []
  const service = createRoamingService({
    async getRoamingTracks(_source, cookie) { calls.push(cookie); return [track('new')] },
  }, (userId) => userId === 'owner' ? 'owner-cookie' : null)
  const result = await service.getNextTrack(room())
  assert.equal(calls[0], 'owner-cookie')
  assert.equal(result?.requestedBy, '私人漫游')
})

test('does not request recommendations when the creator is not logged in', async () => {
  let called = false
  const service = createRoamingService({
    async getRoamingTracks() { called = true; return [track('new')] },
  }, () => null)
  assert.equal(await service.getNextTrack(room()), null)
  assert.equal(called, false)
})

test('filters current and queued songs', async () => {
  const service = createRoamingService({
    async getRoamingTracks() { return [track('current'), track('queued'), track('new')] },
  }, () => 'cookie')
  const result = await service.getNextTrack(room({ currentTrack: track('current'), queue: [track('queued')] }))
  assert.equal(result?.sourceId, 'new')
})

test('passes the selected Netease mode to the recommendation provider', async () => {
  let receivedMode = ''
  const service = createRoamingService({
    async getRoamingTracks(_source, _cookie, mode) {
      receivedMode = mode ?? ''
      return [track('new')]
    },
  }, () => 'cookie')

  await service.getNextTrack(room({ roamingMode: 'SCENE_RCMD:FOCUS' }))
  assert.equal(receivedMode, 'SCENE_RCMD:FOCUS')
})

test('uses the default mode for providers without mode selection', async () => {
  let receivedMode = ''
  const service = createRoamingService({
    async getRoamingTracks(_source, _cookie, mode) {
      receivedMode = mode ?? ''
      return [track('new')]
    },
  }, () => 'cookie')

  await service.getNextTrack(room({ roamingSource: 'tencent', roamingMode: 'EXPLORE' }))
  assert.equal(receivedMode, 'DEFAULT')
})

test('uses the room creator concept-edition account for Kugou concept roaming', async () => {
  let receivedSource = ''
  let receivedCookie = ''
  const service = createRoamingService({
    async getRoamingTracks(source, cookie) {
      receivedSource = source
      receivedCookie = cookie
      return [track('concept')]
    },
  }, (userId, source) => userId === 'owner' && source === 'kugou_concept' ? 'concept-owner-cookie' : null)

  const result = await service.getNextTrack(room({ roamingSource: 'kugou_concept' }))
  assert.equal(receivedSource, 'kugou_concept')
  assert.equal(receivedCookie, 'concept-owner-cookie')
  assert.equal(result?.requestedBy, ROAMING_REQUESTER_LABEL)
})

test('prefers roaming over loop-all wrap at the end of the user queue', () => {
  const first = track('first')
  const last = track('last')
  assert.equal(shouldPreferRoamingForNext(room({ queue: [first, last], currentTrack: last }), 'loop-all'), true)
  assert.equal(shouldPreferRoamingForNext(room({ queue: [first, last], currentTrack: first }), 'loop-all'), false)
})

test('continues roaming after a roaming track without changing loop-one or shuffle semantics', () => {
  const roamingTrack = { ...track('roaming'), requestedBy: ROAMING_REQUESTER_LABEL }
  const roamingRoom = room({ queue: [track('queued')], currentTrack: roamingTrack })
  assert.equal(shouldPreferRoamingForNext(roamingRoom, 'loop-all'), false)
  assert.equal(shouldPreferRoamingForNext({ ...roamingRoom, queue: [] }, 'loop-all'), true)
  assert.equal(shouldPreferRoamingForNext({ ...roamingRoom, queue: [roamingTrack] }, 'loop-all'), true)
  assert.equal(shouldPreferRoamingForNext({ ...roamingRoom, queue: [roamingTrack, track('new-user-song')] }, 'loop-all'), false)
  assert.equal(shouldPreferRoamingForNext(roamingRoom, 'loop-one'), false)
  assert.equal(shouldPreferRoamingForNext(roamingRoom, 'shuffle'), false)
})

test('does not alter next-track selection when roaming is disabled', () => {
  const onlyTrack = track('only')
  assert.equal(shouldPreferRoamingForNext(room({
    roamingEnabled: false,
    queue: [onlyTrack],
    currentTrack: onlyTrack,
  }), 'loop-all'), false)
})

test('parses legacy Netease private-FM metadata including artwork', () => {
  const result = parseNeteaseTrack({
    id: 3319814232,
    name: '致世界 To the World',
    artists: [{ name: '歌手甲' }, { name: '歌手乙' }],
    album: {
      name: '致世界',
      picUrl: 'https://p1.music.126.net/example.jpg',
      pic: 123456,
    },
    duration: 245678,
  })

  assert.equal(result.sourceId, '3319814232')
  assert.deepEqual(result.artist, ['歌手甲', '歌手乙'])
  assert.equal(result.album, '致世界')
  assert.equal(result.duration, 246)
  assert.equal(result.cover, 'https://p1.music.126.net/example.jpg')
})
