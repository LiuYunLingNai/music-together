import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

function resolveDatabasePath(databaseUrl: string): string {
  const rawPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
}

const dbPath = resolveDatabasePath(config.database.url)
mkdirSync(path.dirname(dbPath), { recursive: true })

export const db: BetterSqliteDatabase = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_auth (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    cookie_encrypted TEXT NOT NULL,
    nickname_snapshot TEXT,
    vip_type INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS permanent_rooms (
    id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    chat_history_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS permanent_room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    client_json TEXT,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES permanent_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_permanent_room_members_user ON permanent_room_members(user_id);

  CREATE TABLE IF NOT EXISTS server_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`)

interface TableColumn {
  name: string
}

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare<[], TableColumn>(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

// Keep existing installations upgradeable without requiring a separate migration runner.
ensureColumn('users', 'password_hash', 'password_hash TEXT')
ensureColumn('users', 'role', "role TEXT NOT NULL DEFAULT 'user'")
ensureColumn('platform_auth', 'nickname_snapshot', 'nickname_snapshot TEXT')
ensureColumn('platform_auth', 'vip_type', 'vip_type INTEGER NOT NULL DEFAULT 0')
ensureColumn('platform_auth', 'vip_label', 'vip_label TEXT')
ensureColumn('platform_auth', 'vip_level', 'vip_level INTEGER')
ensureColumn('platform_auth', 'credential_refresh_attempted_at', 'credential_refresh_attempted_at INTEGER')
ensureColumn('permanent_rooms', 'chat_history_json', "chat_history_json TEXT NOT NULL DEFAULT '[]'")
ensureColumn('permanent_room_members', 'client_json', 'client_json TEXT')

const findMigration = db.prepare<[string], { id: string }>('SELECT id FROM schema_migrations WHERE id = ?')
const recordMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')

function runMigrationOnce(id: string, migrate: () => void): void {
  if (findMigration.get(id)) return
  db.transaction(() => {
    if (findMigration.get(id)) return
    migrate()
    recordMigration.run(id, Date.now())
  })()
}

runMigrationOnce('20260729_normalize_platform_membership', () => {
  // Older databases persisted raw provider membership codes (notably
  // Netease 10/11). Runtime policy uses only 0 = none, 1 = VIP, 2 = SVIP.
  db.prepare(
    `
    UPDATE platform_auth
    SET vip_type = CASE
      WHEN platform = 'netease' THEN CASE WHEN vip_type = 2 THEN 2 ELSE 1 END
      ELSE CASE WHEN vip_type >= 2 THEN 2 ELSE 1 END
    END
    WHERE vip_type > 0 AND vip_type NOT IN (1, 2)
  `,
  ).run()

  // Old builds persisted only a generic label. Clear it once so account
  // restore fetches the detailed provider label and persists the result.
  db.prepare(
    `
    UPDATE platform_auth
    SET vip_label = NULL
    WHERE platform IN ('tencent', 'kugou', 'kugou_concept')
      AND vip_type > 0
      AND vip_label IS NOT NULL
      AND UPPER(TRIM(vip_label)) IN ('VIP', 'SVIP')
  `,
  ).run()
})

// Earlier builds classified the non-paid Concept Edition daily benefit as
// SVIP. Queue those rows for an authoritative refresh so they receive the
// corrected listening-VIP tier and FLAC quality cap.
runMigrationOnce('20260729_reclassify_kugou_concept_listening_vip', () => {
  db.prepare(
    `
    UPDATE platform_auth
    SET vip_label = NULL
    WHERE platform = 'kugou_concept' AND vip_type > 0
  `,
  ).run()
})

// vip_type is a provider product code (for example 6), not a normalized
// VIP/SVIP tier. Revalidate existing standard Kugou rows with explicit SVIP
// status and expiry fields before using their quality cap.
runMigrationOnce('20260729_revalidate_kugou_standard_membership', () => {
  db.prepare(
    `
    UPDATE platform_auth
    SET vip_label = NULL
    WHERE platform = 'kugou' AND vip_type > 0
  `,
  ).run()
})

// Earlier builds treated top-level svip like identity.svip and therefore
// misclassified some 绿钻VIP accounts as 超级会员. Queue every persisted QQ
// membership for an authoritative refresh instead of blindly changing tiers.
runMigrationOnce('20260801_revalidate_tencent_identity_membership', () => {
  db.prepare(
    `
    UPDATE platform_auth
    SET vip_label = NULL
    WHERE platform = 'tencent' AND vip_type > 0
  `,
  ).run()
})

// QQ Music credentials persisted by older builds did not contain the refresh
// fields required by LoginServer.Login. Force a clean QR login once so every
// account starts with a refreshable credential.
runMigrationOnce('20260807_reset_tencent_credentials_for_refresh', () => {
  db.prepare("DELETE FROM platform_auth WHERE platform = 'tencent'").run()
})

export const databasePath = dbPath
