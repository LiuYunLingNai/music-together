import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-platform-membership-migration-'))
const databasePath = path.join(testDataDir, 'test.db')
process.env.DATABASE_URL = `file:${databasePath}`
process.env.LOG_LEVEL = 'silent'

const seedDb = new Database(databasePath)
seedDb.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE platform_auth (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    cookie_encrypted TEXT NOT NULL,
    nickname_snapshot TEXT,
    vip_type INTEGER NOT NULL DEFAULT 0,
    vip_label TEXT,
    vip_level INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const insertAuth = seedDb.prepare(`
  INSERT INTO platform_auth (
    id, user_id, platform, cookie_encrypted, nickname_snapshot,
    vip_type, vip_label, vip_level, created_at, updated_at
  ) VALUES (?, 'user', ?, 'cookie', 'nickname', ?, ?, ?, 1, 1)
`)
insertAuth.run('qq', 'tencent', 1, 'VIP', null)
insertAuth.run('kugou', 'kugou', 2, 'SVIP', 5)
insertAuth.run('netease', 'netease', 110, 'VIP·伍', 5)
seedDb.close()

const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('startup migration queues generic QQ/Kugou labels for refresh and normalizes legacy tiers', () => {
  const rows = db
    .prepare<
      [],
      { platform: string; vip_type: number; vip_label: string | null; vip_level: number | null }
    >('SELECT platform, vip_type, vip_label, vip_level FROM platform_auth ORDER BY platform')
    .all()

  assert.deepEqual(rows, [
    { platform: 'kugou', vip_type: 2, vip_label: null, vip_level: 5 },
    { platform: 'netease', vip_type: 1, vip_label: 'VIP·伍', vip_level: 5 },
    { platform: 'tencent', vip_type: 1, vip_label: null, vip_level: null },
  ])
  assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all(), [
    { id: '20260729_normalize_platform_membership' },
    { id: '20260729_reclassify_kugou_concept_listening_vip' },
    { id: '20260729_revalidate_kugou_standard_membership' },
    { id: '20260801_revalidate_tencent_identity_membership' },
  ])
})
