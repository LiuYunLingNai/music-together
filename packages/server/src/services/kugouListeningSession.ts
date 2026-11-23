import { randomUUID } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import {
  SoloPlaybackClock,
  type ListeningEnvironment,
  type ListeningObservation,
  type ListeningSample,
  type LocalListeningSource,
} from '@music-together/shared'
import { SoloListeningService, type SoloBinding } from './soloListeningService.js'
import { remoteListeningWriter, type RemoteListenSource, type RemoteListeningWriter } from './remoteListeningWriter.js'

interface Binding extends RemoteListenSource {
  roomId: string
  socketId: string
  trackId: string
  streamUrl: string
  resolveCookie: () => string | null
  stillAuthorized: () => boolean
  observe: (request: ListeningObservation | null) => void
}

interface Session {
  binding: Binding
  candidates: Map<string, Binding>
  chosen?: string
  id: string
  clock: SoloPlaybackClock
  netPlayedMs: number
  previous?: { sample: ListeningSample; at: number }
  lastObserved?: { positionMs: number; durationMs: number; at: number; wallAt: number }
  pausedAt?: { at: number; wallAt: number }
  earlyFinal?: { sample: ListeningSample; at: number; wallAt: number }
  environment?: ListeningEnvironment
  startedAt?: number
  startRequested: boolean
  startPromise?: Promise<boolean>
  reconnectTimer?: NodeJS.Timeout
}

type LocalPages = Map<string, (source: LocalListeningSource | null) => void>
interface LocalBinding {
  ownerId: string
  accountId: string
  version: string
  pages: LocalPages
  source?: LocalListeningSource
  solo?: Omit<SoloBinding, 'ownerId' | 'accountId' | 'version' | 'sockets'>
}

const MAX_GAP_MS = 6_000
const FINAL_READ_MS = 2_000
const HOUR_MS = 3_600_000
const MIN_START_SAMPLE_MS = 1_000
const DEFAULT_SOCKET_GRACE_MS = 15_000

export interface RecoverableKugouSession {
  ownerId: string
  accountId: string
  trackId: string
  streamUrl: string
  recording: RemoteListenSource['recording']
  title: string
  durationMs: number
  mode: 'direct' | 'transition'
}

export class KugouListeningSessions {
  private readonly rooms = new Map<string, Session>()
  private readonly closing = new Map<
    string,
    { session: Session; next: RemoteListenSource; expiresAt: number; timer: NodeJS.Timeout }
  >()
  private readonly accounts = new Set<string>()
  private readonly inFlight = new Set<string>()
  private readonly settling = new Set<Session>()
  private readonly localPages = new Map<string, LocalBinding>()
  readonly solo: SoloListeningService
  private readonly attempts = new LRUCache<string, number[]>({ max: 10_000, ttl: HOUR_MS })

  constructor(
    private readonly writer?: RemoteListeningWriter,
    private readonly now = () => performance.now(),
    private readonly wallNow = () => Date.now(),
    private readonly socketGraceMs = DEFAULT_SOCKET_GRACE_MS,
  ) {
    this.solo = new SoloListeningService(now, wallNow, socketGraceMs)
  }

  get available(): boolean {
    return this.writer !== undefined
  }

  hasSession(roomId: string): boolean {
    return this.rooms.has(roomId) || this.solo.hasSession(roomId)
  }

  recoverable(roomId: string): RecoverableKugouSession | undefined {
    const session = this.rooms.get(roomId)
    if (session && !session.chosen) {
      return {
        ownerId: session.binding.ownerId,
        accountId: session.binding.recording.accountId,
        trackId: session.binding.trackId,
        streamUrl: session.binding.streamUrl,
        recording: session.binding.recording,
        title: session.binding.title,
        durationMs: session.binding.durationMs,
        mode: 'direct',
      }
    }
    const local = this.localPages.get(roomId)
    if (!local?.solo || !local.source || !this.solo.needsReconnect(roomId)) return undefined
    const source = local.solo.source
    return {
      ownerId: local.ownerId,
      accountId: local.accountId,
      trackId: local.source.trackId,
      streamUrl: local.source.streamUrl,
      recording: source.recording,
      title: source.title,
      durationMs: source.durationMs,
      mode: 'transition',
    }
  }

  reattach(binding: Binding): boolean {
    const session = this.rooms.get(binding.roomId)
    if (
      !session ||
      session.chosen ||
      session.binding.ownerId !== binding.ownerId ||
      session.binding.recording.accountId !== binding.recording.accountId ||
      session.binding.recording.albumAudioId !== binding.recording.albumAudioId ||
      session.binding.trackId !== binding.trackId ||
      session.binding.streamUrl !== binding.streamUrl ||
      !binding.stillAuthorized()
    )
      return false
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = undefined
    }
    session.candidates.set(binding.socketId, binding)
    binding.observe({ sessionId: session.id, trackId: binding.trackId, streamUrl: binding.streamUrl })
    return true
  }

  reattachTransition(roomId: string, ownerId: string, pages: LocalPages): boolean {
    const local = this.localPages.get(roomId)
    if (!local?.solo || !local.source || local.ownerId !== ownerId) return false
    const attached = this.solo.attach(roomId, pages.keys())
    if (!attached.current && !attached.outgoing) return false
    local.pages = pages
    const source = {
      ...local.source,
      ...(attached.current ? { soloSessionId: attached.current } : {}),
    }
    for (const notify of pages.values()) notify(source)
    return true
  }

  async startSolo(listen: Parameters<RemoteListeningWriter['start']>[0]): Promise<boolean> {
    if (!this.writer || !listen.stillAuthorized()) return false
    const recent = (this.attempts.get(listen.recording.accountId) ?? []).filter((at) => this.now() - at < HOUR_MS)
    if (recent.length >= 60) return false
    this.attempts.set(listen.recording.accountId, [...recent, this.now()])
    return this.writer.start(listen)
  }

  async settleSolo(listen: Parameters<RemoteListeningWriter['submit']>[0]): Promise<void> {
    if (!this.writer) return
    if (this.inFlight.has(listen.recording.accountId)) {
      this.writer.cancel(listen.sessionId)
      return
    }
    this.inFlight.add(listen.recording.accountId)
    try {
      await this.writer.submit(listen)
    } finally {
      this.inFlight.delete(listen.recording.accountId)
    }
  }

  cancelSolo(sessionId: string): void {
    this.writer?.cancel(sessionId)
  }

  setLocalPages(roomId: string, binding?: LocalBinding, source?: LocalListeningSource): void {
    const previous = this.localPages.get(roomId)
    const sameOwner =
      previous &&
      binding &&
      previous.ownerId === binding.ownerId &&
      previous.accountId === binding.accountId &&
      previous.version === binding.version
    for (const [id, notify] of previous?.pages ?? []) {
      if (!source || !sameOwner || !binding?.pages.has(id)) notify(null)
    }
    if (!source || !binding?.pages.size) {
      this.localPages.delete(roomId)
      this.solo.clear(roomId)
      return
    }
    binding.source = source
    if (binding.solo) {
      const { ownerId, accountId, version, pages } = binding
      const soloSessionId = this.solo.offer(roomId, {
        ownerId,
        accountId,
        version,
        sockets: new Set(pages.keys()),
        ...binding.solo,
      })
      source = { ...source, soloSessionId }
    } else if (sameOwner) this.solo.retire(roomId)
    else this.solo.clear(roomId)
    this.localPages.set(roomId, binding)
    for (const notify of binding.pages.values()) notify(source)
  }

  begin(input: Binding | Binding[]): void {
    const bindings = Array.isArray(input) ? input : [input]
    const binding = bindings[0]
    if (
      !this.writer ||
      !binding ||
      this.rooms.has(binding.roomId) ||
      this.accounts.has(binding.recording.accountId) ||
      !Number.isFinite(binding.durationMs) ||
      binding.durationMs < 30_000 ||
      !binding.stillAuthorized()
    )
      return
    const id = randomUUID()
    this.rooms.set(binding.roomId, {
      binding,
      candidates: new Map(bindings.map((candidate) => [candidate.socketId, candidate])),
      id,
      clock: new SoloPlaybackClock(),
      netPlayedMs: 0,
      startRequested: false,
    })
    this.accounts.add(binding.recording.accountId)
    for (const candidate of bindings) {
      candidate.observe({ sessionId: id, trackId: candidate.trackId, streamUrl: candidate.streamUrl })
    }
  }

  sample(
    roomId: string,
    ownerId: string,
    socketId: string,
    track: { id: string; streamUrl?: string },
    sample: ListeningSample,
  ): void {
    const session = this.rooms.get(roomId)
    const candidate = session?.candidates.get(socketId)
    if (
      !session ||
      session.id !== sample.sessionId ||
      !candidate ||
      candidate.ownerId !== ownerId ||
      candidate.trackId !== track.id ||
      candidate.streamUrl !== track.streamUrl
    )
      return
    if (!sample.environment) return
    const prev = session.previous
    if (
      Math.abs(session.binding.durationMs - sample.durationMs) > 1_500 ||
      (prev && prev.sample.durationMs !== sample.durationMs)
    ) {
      if (!session.chosen) {
        session.candidates.delete(socketId)
        candidate.observe(null)
        if (!session.candidates.size) this.dropSession(session)
      } else {
        this.cancel(roomId)
      }
      return
    }
    if (!session.chosen) {
      session.chosen = socketId
      session.pausedAt = undefined
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer)
        session.reconnectTimer = undefined
      }
      session.binding = candidate
      for (const [id, other] of session.candidates) {
        if (id !== socketId) other.observe(null)
      }
    }
    if (session.chosen !== socketId) return
    const at = this.now()
    if (prev && (sample.segment < prev.sample.segment || at <= prev.at)) {
      return
    }
    if (!session.startedAt) {
      session.startedAt = this.wallNow()
      session.environment = sample.environment
    }
    session.lastObserved = {
      positionMs: sample.positionMs,
      durationMs: sample.durationMs,
      at,
      wallAt: this.wallNow(),
    }
    session.previous = { sample, at }
    if (!prev || prev.sample.segment !== sample.segment) {
      session.clock.interrupt()
      session.clock.sample(at, sample.positionMs)
      return
    }
    const before = session.clock.totalMs
    session.clock.sample(at, sample.positionMs)
    if (session.clock.totalMs === before) return
    session.netPlayedMs = Math.min(sample.durationMs, Math.floor(session.clock.totalMs))
    this.requestStart(session)
  }

  interrupt(roomId: string): void {
    this.solo.interrupt(roomId)
    const session = this.rooms.get(roomId)
    if (session) {
      session.previous = undefined
      session.pausedAt = undefined
      session.clock.interrupt()
    }
  }

  pause(roomId: string): void {
    this.solo.interrupt(roomId)
    const session = this.rooms.get(roomId)
    if (!session) return
    session.clock.interrupt()
    if (session.lastObserved) session.pausedAt = { at: this.now(), wallAt: this.wallNow() }
  }

  resume(roomId: string): void {
    this.solo.interrupt(roomId)
    const session = this.rooms.get(roomId)
    if (!session) return
    session.previous = undefined
    session.pausedAt = undefined
    session.clock.interrupt()
  }

  seek(roomId: string, playing: boolean): void {
    this.solo.interrupt(roomId)
    const session = this.rooms.get(roomId)
    if (!session) return
    session.previous = undefined
    session.clock.interrupt()
    if (playing) session.pausedAt = undefined
  }

  cancel(roomId: string): void {
    this.setLocalPages(roomId)
    this.dropClosing(roomId)
    this.cancelSettling((s) => s.binding.roomId === roomId)
    const session = this.rooms.get(roomId)
    if (session) this.dropSession(session)
  }

  private dropSession(session: Session): void {
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
    this.writer?.cancel(session.id)
    this.rooms.delete(session.binding.roomId)
    this.accounts.delete(session.binding.recording.accountId)
    for (const binding of session.candidates.values()) binding.observe(null)
    if (!this.localPages.get(session.binding.roomId)?.pages.size) {
      this.localPages.delete(session.binding.roomId)
    }
  }

  cancelOwner(ownerId: string, onlyRoom?: string): void {
    for (const [roomId, local] of this.localPages) {
      if (ownerId === local.ownerId && (!onlyRoom || roomId === onlyRoom)) this.setLocalPages(roomId)
    }
    const matches = (s: Session) => s.binding.ownerId === ownerId && (!onlyRoom || s.binding.roomId === onlyRoom)
    this.cancelSettling(matches)
    for (const [roomId, { session }] of this.closing) {
      if (matches(session)) this.dropClosing(roomId)
    }
    for (const session of this.rooms.values()) {
      if (matches(session)) this.dropSession(session)
    }
  }

  cancelSocket(roomId: string, socketId: string): void {
    this.solo.disconnect(roomId, socketId)
    const local = this.localPages.get(roomId)
    local?.pages.get(socketId)?.(null)
    local?.pages.delete(socketId)
    this.cancelSettling((s) => s.binding.roomId === roomId && s.binding.socketId === socketId)
    if (this.closing.get(roomId)?.session.binding.socketId === socketId) this.dropClosing(roomId)
    const active = this.rooms.get(roomId)
    if (active?.chosen === socketId) {
      const candidate = active.candidates.get(socketId)
      active.candidates.delete(socketId)
      candidate?.observe(null)
      active.chosen = undefined
      active.previous = undefined
      active.clock.interrupt()
      if (active.lastObserved) {
        active.pausedAt = { at: this.now(), wallAt: this.wallNow() }
      }
      if (active.reconnectTimer) clearTimeout(active.reconnectTimer)
      active.reconnectTimer = setTimeout(() => {
        if (active.chosen === undefined && this.rooms.get(roomId) === active) this.dropSession(active)
      }, this.socketGraceMs)
      active.reconnectTimer.unref()
      return
    }
    const candidate = active?.candidates.get(socketId)
    if (active && candidate) {
      active.candidates.delete(socketId)
      candidate.observe(null)
      if (!active.candidates.size) this.dropSession(active)
    }
  }

  private cancelSettling(matches: (session: Session) => boolean): void {
    for (const session of this.settling) {
      if (matches(session)) {
        this.settling.delete(session)
        this.writer?.cancel(session.id)
      }
    }
  }

  private dropClosing(roomId: string, keepWriter = false): void {
    const pending = this.closing.get(roomId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.closing.delete(roomId)
    if (!keepWriter) this.writer?.cancel(pending.session.id)
  }

  finish(roomId: string, next?: RemoteListenSource): void {
    const session = this.rooms.get(roomId)
    if (!session) return
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = undefined
    }
    this.dropClosing(roomId)
    const { binding, netPlayedMs } = session
    const account = binding.recording.accountId
    this.rooms.delete(roomId)
    this.accounts.delete(account)
    if (
      !this.writer ||
      !next ||
      next.ownerId !== binding.ownerId ||
      next.recording.accountId !== account ||
      next.recording.albumAudioId === binding.recording.albumAudioId ||
      !session.chosen ||
      !session.candidates.has(session.chosen) ||
      !session.lastObserved ||
      !session.environment ||
      !session.startedAt ||
      !session.startPromise ||
      (session.pausedAt ? netPlayedMs < 30_000 : netPlayedMs + MAX_GAP_MS < 30_000) ||
      (!session.pausedAt && !session.earlyFinal && this.now() - session.lastObserved.at > MAX_GAP_MS) ||
      !binding.stillAuthorized() ||
      this.inFlight.has(account)
    ) {
      this.writer?.cancel(session.id)
      for (const candidate of session.candidates.values()) candidate.observe(null)
      return
    }
    if (session.earlyFinal) {
      void this.submitMeasured(
        session,
        next,
        session.earlyFinal.sample.positionMs,
        session.earlyFinal.sample.durationMs,
        session.earlyFinal.wallAt,
      )
      return
    }
    if (session.pausedAt) {
      void this.submitMeasured(
        session,
        next,
        session.lastObserved.positionMs,
        session.lastObserved.durationMs,
        session.pausedAt.wallAt,
      )
      return
    }
    const timer = setTimeout(() => this.dropClosing(roomId), FINAL_READ_MS)
    timer.unref()
    this.closing.set(roomId, { session, next, expiresAt: this.now() + FINAL_READ_MS, timer })
    binding.observe({ sessionId: session.id, trackId: binding.trackId, streamUrl: binding.streamUrl, final: true })
  }

  async finalSample(roomId: string, ownerId: string, socketId: string, sample: ListeningSample): Promise<void> {
    const pending = this.closing.get(roomId)
    if (!this.writer || !sample.final) return
    if (!pending) {
      const session = this.rooms.get(roomId)
      if (
        !session ||
        session.id !== sample.sessionId ||
        ownerId !== session.binding.ownerId ||
        socketId !== session.binding.socketId ||
        !sample.naturallyEnded ||
        sample.durationMs !== session.binding.durationMs ||
        this.now() - (session.lastObserved?.at ?? -Infinity) > MAX_GAP_MS
      )
        return
      const normalized = { ...sample, positionMs: sample.durationMs }
      const at = this.now()
      if (session.previous && (normalized.segment < session.previous.sample.segment || at <= session.previous.at))
        return
      const prev = session.previous
      session.lastObserved = {
        positionMs: normalized.positionMs,
        durationMs: normalized.durationMs,
        at,
        wallAt: this.wallNow(),
      }
      session.previous = { sample: normalized, at }
      if (prev && prev.sample.segment === normalized.segment) {
        session.clock.sample(at, normalized.positionMs)
        session.netPlayedMs = Math.min(normalized.durationMs, Math.floor(session.clock.totalMs))
      } else {
        session.clock.interrupt()
        session.clock.sample(at, normalized.positionMs)
      }
      session.earlyFinal = { sample: normalized, at, wallAt: session.lastObserved.wallAt }
      return
    }
    const { session, next } = pending
    const { binding, previous } = session
    if (session.id !== sample.sessionId || ownerId !== binding.ownerId || socketId !== binding.socketId) return
    this.dropClosing(roomId, true)
    const monotonicNow = this.now()
    const endedAt = this.wallNow()
    if (
      !previous ||
      monotonicNow > pending.expiresAt ||
      !binding.stillAuthorized() ||
      sample.durationMs !== previous.sample.durationMs ||
      (sample.segment !== previous.sample.segment &&
        !(sample.naturallyEnded && sample.positionMs >= sample.durationMs - 1_500))
    ) {
      this.writer.cancel(session.id)
      return
    }
    const wall = monotonicNow - previous.at
    const media = sample.positionMs - previous.sample.positionMs
    if (wall > MAX_GAP_MS || wall < 0 || media < 0 || media > wall * 1.05 + 200) {
      this.writer.cancel(session.id)
      return
    }
    const netPlayedMs = Math.min(sample.durationMs, Math.floor(session.netPlayedMs + Math.min(wall, media)))
    const account = binding.recording.accountId
    if (netPlayedMs < 30_000 || this.inFlight.has(account)) {
      this.writer.cancel(session.id)
      return
    }
    await this.submitMeasured(session, next, sample.positionMs, sample.durationMs, endedAt, netPlayedMs)
  }

  private submitMeasured(
    session: Session,
    next: RemoteListenSource,
    finalPositionMs: number,
    mediaDurationMs: number,
    endedAt: number,
    netPlayedMs = session.netPlayedMs,
  ): Promise<void> {
    const { binding } = session
    const account = binding.recording.accountId
    if (netPlayedMs < 30_000 || this.inFlight.has(account)) {
      this.writer?.cancel(session.id)
      return Promise.resolve()
    }
    this.inFlight.add(account)
    this.settling.add(session)
    return (async () => {
      try {
        if (!(await session.startPromise) || !this.settling.has(session) || !binding.stillAuthorized()) return
        await this.writer!.submit({
          sessionId: session.id,
          roomId: binding.roomId,
          ownerId: binding.ownerId,
          recording: binding.recording,
          title: binding.title,
          durationMs: binding.durationMs,
          next,
          mediaDurationMs,
          finalPositionMs,
          startedAt: session.startedAt!,
          endedAt,
          netPlayedMs,
        })
      } finally {
        this.settling.delete(session)
        this.writer?.cancel(session.id)
        this.inFlight.delete(account)
      }
    })()
  }

  private requestStart(session: Session): void {
    if (
      session.startRequested ||
      session.netPlayedMs < MIN_START_SAMPLE_MS ||
      !session.environment ||
      !session.startedAt ||
      !this.writer
    ) {
      return
    }
    const account = session.binding.recording.accountId
    const now = this.now()
    if (this.inFlight.has(account)) return
    const recent = (this.attempts.get(account) ?? []).filter((at) => now - at < HOUR_MS)
    if (recent.length >= 60) {
      session.startRequested = true
      return
    }
    if (now - (recent.at(-1) ?? -Infinity) < 5_000) return
    const cookie = session.binding.resolveCookie()
    if (!cookie) {
      session.startRequested = true
      return
    }
    session.startRequested = true
    this.attempts.set(account, [...recent, now])
    session.startPromise = this.writer
      .start({
        roomId: session.binding.roomId,
        sessionId: session.id,
        ownerId: session.binding.ownerId,
        recording: session.binding.recording,
        title: session.binding.title,
        durationMs: session.binding.durationMs,
        cookie,
        positionMs: session.previous?.sample.positionMs ?? 0,
        startedAt: session.startedAt,
        environment: session.environment,
        stillAuthorized: session.binding.stillAuthorized,
      })
      .catch(() => false)
  }
}

export const kugouListening = new KugouListeningSessions(remoteListeningWriter)
