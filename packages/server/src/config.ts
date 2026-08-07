import 'dotenv/config'
import * as z from 'zod/v4'
import { TIMING } from '@music-together/shared'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8'))

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  IDENTITY_SECRET: z.string().min(16).default('dev-identity-secret-change-me'),
  IDENTITY_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REJOIN_TTL_MS: z.coerce.number().int().positive().default(TIMING.ROOM_GRACE_PERIOD_MS),
  IDENTITY_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  IDENTITY_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  IDENTITY_COOKIE_PARTITIONED: z.enum(['true', 'false']).default('false'),
  AUTO_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  QQ_MUSIC_API_URL: z
    .string()
    .trim()
    .refine((value) => !value || URL.canParse(value), 'QQ_MUSIC_API_URL must be a valid absolute URL')
    .default(''),
  QQ_MUSIC_API_KEY: z.string().trim().default(''),
  DATABASE_URL: z.string().default('file:./data/music-together.db'),
  SERVER_ADMIN_IDS: z.string().default(''),
})

const env = envSchema.parse(process.env)
const isProd = process.env.NODE_ENV === 'production'
const explicitOrigins = [env.CLIENT_URL, ...env.CORS_ORIGINS.split(',')].map((origin) => origin.trim()).filter(Boolean)

export const config = {
  version: rootPkg.version as string,
  port: env.PORT,
  isProd,
  clientUrl: explicitOrigins[0] ?? 'auto',
  explicitOrigins,
  room: {
    gracePeriodMs: TIMING.ROOM_GRACE_PERIOD_MS,
  },
  player: {
    nextDebounceMs: TIMING.PLAYER_NEXT_DEBOUNCE_MS,
  },
  identity: {
    secret: env.IDENTITY_SECRET,
    ttlDays: env.IDENTITY_TTL_DAYS,
    cookieSecure: env.IDENTITY_COOKIE_SECURE ? env.IDENTITY_COOKIE_SECURE === 'true' : null,
    cookieSameSite: env.IDENTITY_COOKIE_SAME_SITE,
    cookiePartitioned: env.IDENTITY_COOKIE_PARTITIONED === 'true',
  },
  rejoin: {
    ttlMs: env.REJOIN_TTL_MS,
  },
  autoFallback: {
    enabled: env.AUTO_FALLBACK_ENABLED === 'true',
  },
  qqMusicApi: {
    url: env.QQ_MUSIC_API_URL,
    key: env.QQ_MUSIC_API_KEY,
  },
  database: {
    url: env.DATABASE_URL,
  },
  serverAdminIds: new Set(
    env.SERVER_ADMIN_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  ),
} as const
