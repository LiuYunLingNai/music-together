import { randomUUID } from 'node:crypto'
import {
  SOLO_MAX_GAP_MS,
  SoloPlaybackClock,
  type ListeningEnvironment,
  type SoloProgress,
  type SoloSettlement,
} from '@music-together/shared'
import type { RemoteListenSource } from './remoteListeningWriter.js'
import { LRUCache } from 'lru-cache'

export interface SoloStartContext {
  socketId: string
  sessionId: string
  startedAt: number
  positionMs: number
  environment: ListeningEnvironment
}

export interface SoloFinishContext extends SoloSettlement {
  socketId: string
  startedAt: number
  endedAt: number
  finalPositionMs: number
  mediaDurationMs: number
  next?: RemoteListenSource
}

export interface SoloBinding {
  ownerId: string
  accountId: string
  version: string
  trackId: string
  albumAudioId: string
  durationMs: number
  startsInMs?: number
  sockets: Set<string>
  source: RemoteListenSource
  authorized: () => boolean
  start: (context: SoloStartContext) => Promise<boolean>
  settled: (context: SoloFinishContext) => void
  cancel: (sessionId: string) => void
}

interface Observer {
  clock: SoloPlaybackClock
  segment: number
  duration: number
  lastAt: number
  lastPos: number
}
interface Track extends SoloBinding {
  id: string
  notBefore: number
  candidates: Map<string, Observer>
  chosen?: string
  banked: number
  lastProgress: number
  startPromise?: Promise<boolean>
  startedAt?: number
  environment?: ListeningEnvironment
}
interface Pair {
  current?: Track
  outgoing?: Track
}

export class SoloListeningService {
  private rooms = new Map<string, Pair>()
  private accounts = new Map<string, Track>()
  private reconnectTimers = new Map<string, NodeJS.Timeout>()
  private through = new LRUCache<string, number>({ max: 10_000, ttl: SOLO_MAX_GAP_MS * 2 })

  constructor(
    private readonly now = () => performance.now(),
    private readonly wallNow = () => Date.now(),
    private readonly reconnectGraceMs = 15_000,
  ) {}

  hasSession(room: string): boolean {
    return this.rooms.has(room)
  }

  needsReconnect(room: string): boolean {
    const pair = this.rooms.get(room)
    return Boolean(
      pair && [pair.current, pair.outgoing].some((track) => track && track.sockets.size === 0 && !track.chosen),
    )
  }

  attach(room: string, sockets: Iterable<string>): { current?: string; outgoing?: string } {
    const pair = this.rooms.get(room)
    if (!pair) return {}
    const timer = this.reconnectTimers.get(room)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(room)
    }
    for (const socket of sockets) {
      pair.current?.sockets.add(socket)
      pair.outgoing?.sockets.add(socket)
    }
    return { current: pair.current?.id, outgoing: pair.outgoing?.id }
  }

  offer(room: string, binding: SoloBinding): string | undefined {
    if (!/^[1-9]\d*$/.test(binding.albumAudioId) || !Number.isFinite(binding.durationMs) || binding.durationMs <= 0) {
      this.clear(room)
      return
    }
    const previous = this.rooms.get(room)
    if (previous?.outgoing) this.release(previous.outgoing)
    const old = previous?.current
    const same =
      old && old.ownerId === binding.ownerId && old.accountId === binding.accountId && old.version === binding.version
    if (old && !same) this.release(old)
    const current: Track = {
      ...binding,
      id: randomUUID(),
      notBefore: this.now() + Math.max(0, binding.startsInMs ?? 0),
      candidates: new Map(),
      banked: 0,
      lastProgress: -Infinity,
    }
    this.rooms.set(room, { current, outgoing: same ? old : undefined })
    return current.id
  }

  retire(room: string): void {
    const pair = this.rooms.get(room)
    if (!pair?.current) return this.clear(room)
    if (pair.outgoing) this.release(pair.outgoing)
    this.rooms.set(room, { outgoing: pair.current })
  }

  accept(room: string, owner: string, socket: string, msg: SoloProgress): void {
    const pair = this.rooms.get(room)
    if (!pair) return
    const track =
      pair.current?.id === msg.sessionId
        ? pair.current
        : pair.outgoing?.id === msg.sessionId
          ? pair.outgoing
          : undefined
    if (!track || track.ownerId !== owner || !track.sockets.has(socket)) return
    if (msg.kind === 'end') {
      if (track === pair.outgoing && track.chosen === socket) {
        this.finish(pair, track)
        if (!pair.current) this.rooms.delete(room)
      }
      return
    }
    const at = this.now()
    if (at < track.notBefore || Math.abs(msg.durationMs - track.durationMs) > 1_500) return
    const held = this.accounts.get(track.accountId)
    if (held && (held !== track || (held.chosen !== undefined && held.chosen !== socket))) {
      if (track === pair.current && held === pair.outgoing && held.chosen === socket) this.finish(pair, held)
      else if (at - held.lastProgress > SOLO_MAX_GAP_MS && track !== pair.outgoing) this.park(held)
      else return
    }
    let o = track.candidates.get(socket)
    if (!o) {
      o = {
        clock: new SoloPlaybackClock(),
        segment: msg.segment,
        duration: msg.durationMs,
        lastAt: at,
        lastPos: msg.positionMs,
      }
      track.candidates.set(socket, o)
    }
    if (
      msg.durationMs !== o.duration ||
      msg.segment < o.segment ||
      at < o.lastAt ||
      (msg.segment === o.segment && msg.positionMs < o.lastPos)
    )
      return
    if (msg.segment !== o.segment || (!track.chosen && o.lastAt < (this.through.get(track.accountId) ?? -Infinity)))
      o.clock.interrupt()
    const before = o.clock.totalMs
    o.clock.sample(at, msg.positionMs)
    o.segment = msg.segment
    o.lastAt = at
    o.lastPos = msg.positionMs
    if (o.clock.totalMs === before) return
    if (!track.chosen) {
      if (!track.authorized()) return this.clear(room)
      track.chosen = socket
      track.candidates = new Map([[socket, o]])
      this.accounts.set(track.accountId, track)
      if (!track.startPromise) this.beginStart(track, socket, msg.environment, msg.positionMs)
    } else if (!track.startPromise) {
      this.beginStart(track, socket, msg.environment, msg.positionMs)
    }
    track.lastProgress = at
    this.through.set(track.accountId, at)
  }

  interrupt(room: string): void {
    const pair = this.rooms.get(room)
    for (const track of [pair?.current, pair?.outgoing]) {
      for (const o of track?.candidates.values() ?? []) o.clock.interrupt()
    }
  }

  disconnect(room: string, socket: string): void {
    const pair = this.rooms.get(room)
    for (const track of [pair?.current, pair?.outgoing]) {
      if (!track) continue
      track.sockets.delete(socket)
      if (track.chosen === socket) {
        const observer = track.candidates.get(socket)
        if (observer) track.banked += observer.clock.totalMs
        track.candidates.delete(socket)
        track.chosen = undefined
      } else track.candidates.delete(socket)
    }
    if (pair && !pair.current?.chosen && !pair.outgoing?.chosen && !this.reconnectTimers.has(room)) {
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(room)
        const current = this.rooms.get(room)
        if (!current?.current?.chosen && !current?.outgoing?.chosen) this.clear(room)
      }, this.reconnectGraceMs)
      timer.unref()
      this.reconnectTimers.set(room, timer)
    }
  }

  clear(room: string): void {
    const timer = this.reconnectTimers.get(room)
    if (timer) clearTimeout(timer)
    this.reconnectTimers.delete(room)
    const pair = this.rooms.get(room)
    if (pair) {
      if (pair.outgoing) this.release(pair.outgoing)
      if (pair.current) this.release(pair.current)
      this.rooms.delete(room)
    }
  }

  private release(track: Track, preserveStart = false): void {
    if (!preserveStart && track.startPromise) track.cancel(track.id)
    if (this.accounts.get(track.accountId) === track) this.accounts.delete(track.accountId)
    track.candidates.clear()
  }

  private park(track: Track): void {
    if (track.chosen) track.banked += track.candidates.get(track.chosen)?.clock.totalMs ?? 0
    this.release(track)
    track.chosen = undefined
  }

  private finish(pair: Pair, track: Track): void {
    const socket = track.chosen
    const observer = socket ? track.candidates.get(socket) : undefined
    const milliseconds = observer ? Math.floor(Math.min(track.banked + observer.clock.totalMs, observer.duration)) : 0
    const next =
      pair.current &&
      pair.current !== track &&
      pair.current.ownerId === track.ownerId &&
      pair.current.accountId === track.accountId &&
      pair.current.version === track.version &&
      pair.current.albumAudioId !== track.albumAudioId
        ? pair.current.source
        : undefined
    pair.outgoing = undefined
    const canReport = Boolean(socket && observer && track.startPromise && milliseconds >= 30_000)
    this.release(track, canReport)
    if (!socket || !observer || !track.startPromise || milliseconds < 30_000) return
    const startedAt = track.startedAt
    if (startedAt === undefined) return
    const endedAt = this.wallNow()
    const finalPositionMs = observer.lastPos
    const mediaDurationMs = observer.duration
    void track.startPromise.then((opened) => {
      if (!opened || !track.authorized()) {
        track.cancel(track.id)
        return
      }
      track.settled({
        socketId: socket,
        sessionId: track.id,
        trackId: track.trackId,
        milliseconds,
        startedAt,
        endedAt,
        finalPositionMs,
        mediaDurationMs,
        next,
      })
      if (!next) track.cancel(track.id)
    })
  }

  private beginStart(track: Track, socket: string, environment: ListeningEnvironment, positionMs: number): void {
    const startedAt = this.wallNow()
    track.startedAt = startedAt
    track.environment = environment
    track.startPromise = Promise.resolve(
      track.start({
        socketId: socket,
        sessionId: track.id,
        startedAt,
        positionMs,
        environment,
      }),
    )
      .catch(() => false)
      .then((opened) => {
        if (!opened && track.chosen === socket) this.park(track)
        return opened
      })
  }
}
