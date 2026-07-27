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

export const databasePath = dbPath
