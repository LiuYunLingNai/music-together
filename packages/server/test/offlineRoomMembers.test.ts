import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-offline-members-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const roomService = await import('../src/services/roomService.js')
const { db } = await import('../src/repositories/database.js')
const { InMemoryRoomRepository, roomRepo } = await import('../src/repositories/roomRepository.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('keeps offline members in a permanent room roster after reload', () => {
  const { room } = roomService.createRoom('owner-socket', 'Owner', 'Roster room', null, 'owner-id')
  roomService.updateSettings(room.id, { permanent: true })

  const joined = roomService.joinRoom('member-socket', room.id, 'Member', 'member-id')
  assert.ok(joined)
  assert.equal(joined.room.members.length, 2)
  assert.equal(joined.room.members.find((member) => member.id === 'member-id')?.isOnline, true)

  roomService.leaveRoom('member-socket')
  const offlineMember = room.members.find((member) => member.id === 'member-id')
  assert.deepEqual(
    offlineMember && {
      id: offlineMember.id,
      role: offlineMember.role,
      isOnline: offlineMember.isOnline,
      hasLastSeenAt: offlineMember.lastSeenAt !== null,
    },
    { id: 'member-id', role: 'member', isOnline: false, hasLastSeenAt: true },
  )

  const persistedCount = db
    .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM permanent_room_members WHERE room_id = ?')
    .get(room.id)
  assert.equal(persistedCount?.count, 2)

  const restoredRepo = new InMemoryRoomRepository()
  const restoredRoom = restoredRepo.get(room.id)
  assert.equal(restoredRoom?.users.length, 0)
  assert.deepEqual(
    restoredRoom?.members.map((member) => ({ id: member.id, isOnline: member.isOnline })),
    [
      { id: 'owner-id', isOnline: false },
      { id: 'member-id', isOnline: false },
    ],
  )

  roomRepo.delete(room.id)
})

test('restores the last identified device for an offline member after reload', () => {
  const client = { kind: 'windows' as const, label: 'Windows 客户端' }
  const { room } = roomService.createRoom('device-owner-socket', 'Owner', 'Device room', null, 'device-owner-id', client)
  roomService.updateSettings(room.id, { permanent: true })

  roomService.leaveRoom('device-owner-socket')
  assert.equal(room.members[0]?.isOnline, false)
  assert.deepEqual(room.members[0]?.lastClient, client)
  assert.equal(room.members[0]?.client, undefined)
  assert.equal(room.members[0]?.clients, undefined)

  const restoredRoom = new InMemoryRoomRepository().get(room.id)
  assert.deepEqual(restoredRoom?.members[0]?.lastClient, client)
  assert.equal(restoredRoom?.members[0]?.isOnline, false)
  assert.equal(restoredRoom?.members[0]?.clients, undefined)

  roomRepo.delete(room.id)
})

test('restores the permanent room track and saved playback position after reload', () => {
  const { room } = roomService.createRoom('player-socket', 'Player', 'Playback room', null, 'player-id')
  roomService.updateSettings(room.id, { permanent: true })
  room.currentTrack = {
    id: 'saved-track',
    title: 'Saved song',
    artist: ['Saved artist'],
    album: 'Saved album',
    duration: 240,
    cover: '',
    source: 'netease',
    sourceId: '123',
    urlId: '123',
    streamUrl: 'https://expired.example.test/stream',
  }
  room.playState = { isPlaying: true, currentTime: 91.25, serverTimestamp: Date.now() - 1_000 }
  roomRepo.persist(room.id)

  const restoredRoom = new InMemoryRoomRepository().get(room.id)
  const { streamUrl: _streamUrl, ...expectedTrack } = room.currentTrack
  assert.deepEqual(restoredRoom?.currentTrack, expectedTrack)
  assert.deepEqual(restoredRoom?.playState.isPlaying, false)
  assert.equal(restoredRoom?.playState.currentTime, 91.25)

  roomRepo.delete(room.id)
})

test('updates the roster role when an online member becomes temporary admin', () => {
  const { room } = roomService.createRoom('owner-socket', 'Owner', 'Role sync room', null, 'owner-role-id')
  const joined = roomService.joinRoom('member-socket', room.id, 'Member', 'member-role-id')
  assert.ok(joined)

  const left = roomService.leaveRoom('owner-socket')
  assert.ok(left)
  assert.equal(left.roleChanged, true)
  assert.equal(room.users.find((user) => user.id === 'member-role-id')?.role, 'admin')
  assert.equal(room.members.find((member) => member.id === 'member-role-id')?.role, 'admin')

  roomRepo.delete(room.id)
})

test('clears a temporary admin role when the room becomes empty before owner returns', () => {
  const { room } = roomService.createRoom('owner-empty-socket', 'Owner', 'Role reset room', null, 'owner-empty-id')
  const ownerLeft = roomService.leaveRoom('owner-empty-socket')
  assert.ok(ownerLeft)

  const memberJoined = roomService.joinRoom('member-empty-socket', room.id, 'Member', 'member-empty-id')
  assert.ok(memberJoined)
  assert.equal(room.members.find((member) => member.id === 'member-empty-id')?.role, 'admin')

  const memberLeft = roomService.leaveRoom('member-empty-socket')
  assert.ok(memberLeft)
  assert.equal(room.members.find((member) => member.id === 'member-empty-id')?.role, 'member')

  const ownerReturned = roomService.joinRoom('owner-return-socket', room.id, 'Owner', 'owner-empty-id')
  assert.ok(ownerReturned)
  assert.equal(ownerReturned.room.members.find((member) => member.id === 'member-empty-id')?.role, 'member')

  roomRepo.delete(room.id)
})

test('keeps every active client visible for an account with multiple sockets', () => {
  const androidClient = { kind: 'android' as const, label: 'Android 客户端' }
  const windowsClient = { kind: 'windows' as const, label: 'Windows 客户端' }
  const { room } = roomService.createRoom(
    'multi-android-socket',
    'Multi-device user',
    'Multi-device room',
    null,
    'multi-device-id',
    androidClient,
  )

  const secondConnection = roomService.joinRoom(
    'multi-windows-socket',
    room.id,
    'Multi-device user',
    'multi-device-id',
    windowsClient,
  )
  assert.ok(secondConnection)
  assert.equal(room.users.length, 1)
  assert.deepEqual(secondConnection.user.clients, [androidClient, windowsClient])
  assert.deepEqual(room.members[0]?.clients, [androidClient, windowsClient])

  const firstDisconnected = roomService.leaveRoom('multi-android-socket')
  assert.ok(firstDisconnected)
  assert.equal(firstDisconnected.staleSocketOnly, true)
  assert.deepEqual(firstDisconnected.user.clients, [windowsClient])
  assert.deepEqual(room.members[0]?.clients, [windowsClient])

  const finalDisconnected = roomService.leaveRoom('multi-windows-socket')
  assert.ok(finalDisconnected)
  assert.equal(finalDisconnected.staleSocketOnly, false)
  assert.equal(room.members[0]?.clients, undefined)
  assert.deepEqual(room.members[0]?.lastClient, windowsClient)

  roomRepo.delete(room.id)
})

test('groups identical active client labels by connection count', () => {
  const androidClient = { kind: 'android' as const, label: 'Android 客户端' }
  const { room } = roomService.createRoom(
    'duplicate-client-socket-1',
    'Duplicate device user',
    'Duplicate device room',
    null,
    'duplicate-device-id',
    androidClient,
  )

  const secondConnection = roomService.joinRoom(
    'duplicate-client-socket-2',
    room.id,
    'Duplicate device user',
    'duplicate-device-id',
    androidClient,
  )
  assert.ok(secondConnection)
  assert.deepEqual(secondConnection.user.clients, [{ ...androidClient, count: 2 }])

  roomService.leaveRoom('duplicate-client-socket-1')
  assert.deepEqual(secondConnection.user.clients, [androidClient])

  roomService.leaveRoom('duplicate-client-socket-2')
  roomRepo.delete(room.id)
})
