import type { KugouListeningReport } from '@music-together/shared'
import { kugouListeningAccount, createKugouListeningApi } from './kugouListeningApi.js'

interface Session {
  account: string
  roomId: string
  trackId: string
  total: number
  lastAt: number
  ended: boolean
}
interface Account {
  creditedUntil: number
  pendingMs: number
  updatedAt: number
  retryAfter: number
  busy: boolean
  baselineFloor: number
}
export interface ListeningContext {
  userId: string
  cookie: string
  currentTrackId: string | null
}

/** In-memory accounting. Failure is deliberately at-most-once, since upstream has no idempotency key. */
export function createKugouListeningService(api = createKugouListeningApi(), now = Date.now) {
  const sessions = new Map<string, Session>()
  const accounts = new Map<string, Account>()
  return {
    async report(input: KugouListeningReport, context: ListeningContext) {
      const time = now()
      for (const [key, value] of sessions) if (time - value.lastAt > 600_000) sessions.delete(key)
      for (const [key, value] of accounts) {
        if (!value.busy && time - value.updatedAt > 600_000) accounts.delete(key)
      }
      const accountId = kugouListeningAccount(context.cookie)
      if (!accountId) return { status: 'not_logged_in' as const }
      const key = `${context.userId}:${input.sessionId}`
      let session = sessions.get(key)
      if (!session) {
        if (input.ended || input.listenedMs !== 0 || context.currentTrackId !== input.trackId) {
          return { status: 'invalid_session' as const }
        }
        if (sessions.size >= 5000 || accounts.size >= 5000) return { status: 'unavailable' as const }
        session = {
          account: accountId,
          roomId: input.roomId,
          trackId: input.trackId,
          total: 0,
          lastAt: time,
          ended: false,
        }
        sessions.set(key, session)
      }
      if (
        session.account !== accountId ||
        session.roomId !== input.roomId ||
        session.trackId !== input.trackId ||
        (!input.ended && context.currentTrackId !== input.trackId) ||
        input.listenedMs < session.total
      ) {
        return { status: 'invalid_session' as const }
      }
      if (session.ended) return { status: 'accepted' as const }
      let account = accounts.get(accountId)
      if (!account) {
        account = { creditedUntil: time, pendingMs: 0, updatedAt: time, retryAfter: 0, busy: false, baselineFloor: 0 }
        accounts.set(accountId, account)
      }
      // Union of recent listening intervals, shared across identities, rooms and devices.
      // A disconnected client may not backfill an arbitrary amount of historical time.
      const delta = Math.min(input.listenedMs - session.total, Math.max(0, time - session.lastAt), 30_000)
      const credited = Math.max(0, time - Math.max(time - delta, account.creditedUntil))
      account.pendingMs += credited
      if (credited > 0) account.creditedUntil = time
      account.updatedAt = time
      session.total = input.listenedMs
      session.lastAt = time
      session.ended = input.ended
      const seconds = Math.floor(account.pendingMs / 1000)
      if (
        (!input.ended && !input.flush && seconds < 60) ||
        seconds === 0 ||
        account.busy ||
        time < account.retryAfter
      ) {
        return { status: 'accepted' as const }
      }
      account.busy = true
      account.pendingMs -= seconds * 1000
      try {
        const baseline = Math.max(await api.query(context.cookie), account.baselineFloor)
        await api.submit(context.cookie, baseline, seconds)
        account.baselineFloor = baseline + seconds
        return { status: 'submitted' as const, seconds }
      } catch {
        // An upstream timeout may already have committed. Never replay this increment.
        account.retryAfter = time + 60_000
        return { status: 'upstream_unavailable' as const }
      } finally {
        account.busy = false
      }
    },
  }
}
