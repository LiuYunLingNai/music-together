import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-room-migration-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { db } = await import('../src/repositories/database.js')

const legacyState = {
  name: '秋的房间',
  passwordEncrypted: null,
  creatorId: 'wing',
  adminUserIds: ['admin-1'],
  hidden: true,
  audioQuality: 'netease_jyeffect',
  queue: [],
  currentTrack: null,
  playState: {
    isPlaying: false,
    currentTime: 80.862,
    serverTimestamp: 1_785_305_576_966,
  },
  playMode: 'shuffle',
  futureField: { nested: ['must', 'survive'] },
}

const otherLegacyQualities = [
  'netease_hires',
  'netease_dolby',
  'netease_spatial',
  'netease_master',
  'tencent_flac',
  'tencent_master',
  'kugou_hires',
  'kugou_master',
] as const

const explicitSqState = {
  ...legacyState,
  name: 'Explicit SQ',
  creatorId: 'sq-user',
  audioQuality: 999,
}

const insertRoom = db.prepare(
  'INSERT INTO permanent_rooms (id, state_json, chat_history_json, updated_at) VALUES (?, ?, ?, ?)',
)
insertRoom.run('CDIBR9', JSON.stringify(legacyState), '[{"content":"preserve chat"}]', 100)
for (const [index, audioQuality] of otherLegacyQualities.entries()) {
  insertRoom.run(
    `LEGACY${index}`,
    JSON.stringify({ ...legacyState, name: `Legacy ${audioQuality}`, audioQuality }),
    '[]',
    200 + index,
  )
}
insertRoom.run('SQROOM', JSON.stringify(explicitSqState), '[]', 300)
insertRoom.run('BROKEN', '{invalid json', '[]', 400)

const { InMemoryRoomRepository, roomRepo } = await import('../src/repositories/roomRepository.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('migrates legacy SQ-or-higher provider qualities in memory and in SQLite exactly once', () => {
  assert.equal(roomRepo.get('CDIBR9')?.audioQuality, 'highest')
  for (const index of otherLegacyQualities.keys()) {
    assert.equal(roomRepo.get(`LEGACY${index}`)?.audioQuality, 'highest')
  }

  const firstRow = db
    .prepare<
      [],
      { state_json: string; chat_history_json: string; updated_at: number }
    >("SELECT state_json, chat_history_json, updated_at FROM permanent_rooms WHERE id = 'CDIBR9'")
    .get()
  assert.ok(firstRow)
  assert.deepEqual(JSON.parse(firstRow.state_json), { ...legacyState, audioQuality: 'highest' })
  assert.equal(firstRow.chat_history_json, '[{"content":"preserve chat"}]')
  assert.ok(firstRow.updated_at > 100)

  const otherFirstRows = db
    .prepare<
      [],
      { id: string; state_json: string; updated_at: number }
    >("SELECT id, state_json, updated_at FROM permanent_rooms WHERE id LIKE 'LEGACY%' ORDER BY id")
    .all()
  assert.equal(otherFirstRows.length, otherLegacyQualities.length)
  for (const [index, row] of otherFirstRows.entries()) {
    assert.equal(JSON.parse(row.state_json).audioQuality, 'highest')
    assert.ok(row.updated_at > 200 + index)
  }

  const reloadedRepo = new InMemoryRoomRepository()
  assert.equal(reloadedRepo.get('CDIBR9')?.audioQuality, 'highest')
  for (const index of otherLegacyQualities.keys()) {
    assert.equal(reloadedRepo.get(`LEGACY${index}`)?.audioQuality, 'highest')
  }

  const secondRow = db
    .prepare<
      [],
      { state_json: string; updated_at: number }
    >("SELECT state_json, updated_at FROM permanent_rooms WHERE id = 'CDIBR9'")
    .get()
  assert.ok(secondRow)
  assert.equal(secondRow.state_json, firstRow.state_json)
  assert.equal(secondRow.updated_at, firstRow.updated_at)

  const otherSecondRows = db
    .prepare<
      [],
      { id: string; state_json: string; updated_at: number }
    >("SELECT id, state_json, updated_at FROM permanent_rooms WHERE id LIKE 'LEGACY%' ORDER BY id")
    .all()
  assert.deepEqual(otherSecondRows, otherFirstRows)
})

test('preserves explicit numeric SQ and startup after one malformed row', () => {
  assert.equal(roomRepo.get('SQROOM')?.audioQuality, 999)
  assert.equal(roomRepo.get('BROKEN'), undefined)

  const sqRow = db
    .prepare<
      [],
      { state_json: string; updated_at: number }
    >("SELECT state_json, updated_at FROM permanent_rooms WHERE id = 'SQROOM'")
    .get()
  assert.deepEqual(JSON.parse(sqRow!.state_json), explicitSqState)
  assert.equal(sqRow!.updated_at, 300)
})
