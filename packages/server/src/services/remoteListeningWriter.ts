import {
  constants as cryptoConstants,
  createCipheriv,
  createHash,
  createHmac,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto'
import { LRUCache } from 'lru-cache'
import type { ListeningEnvironment } from '@music-together/shared'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'

export interface RemoteListeningDevice {
  mid: string
  uuid: string
  dfid: string
  q36?: string
  kgDevid?: string
}

export interface RemoteListeningRecording {
  accountId: string
  albumAudioId: string
  fileHash: string
  fileSizeBytes: number
  bitrateKbps: number
  device: RemoteListeningDevice
}

export interface RemoteListenSource {
  ownerId: string
  recording: RemoteListeningRecording
  title: string
  durationMs: number
}

export interface RemoteListenStart extends RemoteListenSource {
  roomId: string
  sessionId: string
  cookie: string
  positionMs: number
  startedAt: number
  environment: ListeningEnvironment
  stillAuthorized: () => boolean
}

export interface RemoteMeasuredListen extends RemoteListenSource {
  roomId: string
  sessionId: string
  mediaDurationMs: number
  finalPositionMs: number
  startedAt: number
  endedAt: number
  netPlayedMs: number
  next: RemoteListenSource
}

export interface RemoteListeningWriter {
  start(listen: RemoteListenStart): Promise<boolean>
  submit(listen: RemoteMeasuredListen): Promise<void>
  cancel(sessionId: string): void
}

export interface RemoteAdapterConfig {
  url: string
  instanceId: string
  instanceSecret: string
  cookiePublicKey: string
  timeoutMs: number
}

interface EncryptedCookie {
  algorithm: 'AES-256-GCM+RSA-OAEP-SHA256'
  wrappedKey: string
  iv: string
  ciphertext: string
  tag: string
}

interface StartResponse {
  accepted: true
  outcome: 'accepted'
  resumeToken: string
  expiresAt: number
  gradeSynced: false
}

interface FinishResponse {
  accepted: true
  outcome: 'accepted'
  gradeSynced: false
}

interface PendingStart {
  resumeToken: string
  expiresAt: number
  controller: AbortController
  stillAuthorized: () => boolean
}

const START_PATH = '/v1/kugou/start'
const FINISH_PATH = '/v1/kugou/finish'
const SESSION_TTL_MS = 6 * 60 * 60 * 1_000
const MAX_RESPONSE_BYTES = 64 * 1_024

function endpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl)
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== '/' && base.pathname !== '')
  ) {
    throw new Error('KUGOU_REPORT_ADAPTER_URL must be an HTTPS origin')
  }
  return new URL(path, base)
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function acceptedStart(value: unknown): value is StartResponse {
  const record = responseRecord(value)
  return Boolean(
    record &&
    record.accepted === true &&
    record.outcome === 'accepted' &&
    typeof record.resumeToken === 'string' &&
    /^[A-Za-z0-9_-]{40,32000}$/.test(record.resumeToken) &&
    Number.isSafeInteger(record.expiresAt) &&
    Number(record.expiresAt) > Date.now() &&
    record.gradeSynced === false,
  )
}

function acceptedFinish(value: unknown): value is FinishResponse {
  const record = responseRecord(value)
  return Boolean(record && record.accepted === true && record.outcome === 'accepted' && record.gradeSynced === false)
}

export class HttpRemoteListeningWriter implements RemoteListeningWriter {
  private readonly starts = new LRUCache<string, PendingStart>({
    max: 1_000,
    ttl: SESSION_TTL_MS,
    dispose: (pending) => pending.controller.abort(),
  })
  private readonly publicKey?: KeyObject
  private readonly adapterUrlValid: boolean

  constructor(
    private readonly options: RemoteAdapterConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    try {
      this.publicKey = options.cookiePublicKey ? createPublicKey(options.cookiePublicKey) : undefined
    } catch {
      this.publicKey = undefined
    }
    try {
      endpoint(options.url, START_PATH)
      this.adapterUrlValid = true
    } catch {
      this.adapterUrlValid = false
    }
  }

  get available(): boolean {
    return Boolean(
      this.options.url &&
      this.adapterUrlValid &&
      this.options.instanceId &&
      this.options.instanceSecret &&
      this.publicKey,
    )
  }

  async start(listen: RemoteListenStart): Promise<boolean> {
    if (!this.available || !listen.stillAuthorized() || this.starts.has(listen.sessionId)) return false
    const controller = new AbortController()
    try {
      const allowed = () => !controller.signal.aborted && listen.stillAuthorized()
      const body = JSON.stringify({
        schemaVersion: 1,
        sessionId: listen.sessionId,
        recording: {
          provider: 'kugou',
          accountId: listen.recording.accountId,
          albumAudioId: listen.recording.albumAudioId,
          fileHash: listen.recording.fileHash,
          fileSizeBytes: listen.recording.fileSizeBytes,
          bitrateKbps: listen.recording.bitrateKbps,
          device: listen.recording.device,
        },
        track: {
          title: listen.title,
          durationMs: listen.durationMs,
          positionMs: listen.positionMs,
          startedAt: listen.startedAt,
        },
        environment: listen.environment,
        cookie: this.encryptCookie(listen.cookie),
      })
      const response = await this.send(START_PATH, body, controller.signal, allowed)
      if (!response || !allowed() || !acceptedStart(response)) {
        controller.abort()
        return false
      }
      this.starts.set(listen.sessionId, {
        resumeToken: response.resumeToken,
        expiresAt: response.expiresAt,
        controller,
        stillAuthorized: listen.stillAuthorized,
      })
      return true
    } catch {
      controller.abort()
      return false
    }
  }

  async submit(listen: RemoteMeasuredListen): Promise<void> {
    const pending = this.starts.get(listen.sessionId)
    if (!pending || !pending.stillAuthorized()) return
    try {
      const actualMs = Math.floor(listen.netPlayedMs)
      if (
        actualMs < 30_000 ||
        actualMs > Math.round(listen.mediaDurationMs) ||
        listen.endedAt < listen.startedAt ||
        listen.endedAt - listen.startedAt < actualMs ||
        pending.expiresAt <= Date.now()
      )
        return
      const body = JSON.stringify({
        schemaVersion: 1,
        sessionId: listen.sessionId,
        resumeToken: pending.resumeToken,
        playback: {
          actualMs,
          startedAt: listen.startedAt,
          endedAt: listen.endedAt,
          finalPositionMs: Math.min(Math.round(listen.finalPositionMs), Math.round(listen.mediaDurationMs)),
          mediaDurationMs: Math.round(listen.mediaDurationMs),
        },
        next: {
          albumAudioId: listen.next.recording.albumAudioId,
          title: listen.next.title,
          durationMs: listen.next.durationMs,
        },
      })
      const response = await this.send(FINISH_PATH, body, pending.controller.signal, () => pending.stillAuthorized())
      if (!response || !pending.stillAuthorized() || !acceptedFinish(response)) return
      logger.info('远程听歌时长适配器已确认请求', {
        event: 'player.remote_listening_report',
        outcome: 'accepted',
        gradeSynced: false,
      })
    } catch (error) {
      if (!pending.stillAuthorized()) return
      logger.warn('远程听歌时长适配器请求失败', {
        event: 'player.remote_listening_report_failed',
        errorCode: error instanceof Error ? error.name.slice(0, 64) : 'UnknownError',
      })
    } finally {
      if (this.starts.peek(listen.sessionId) === pending) this.cancel(listen.sessionId)
    }
  }

  cancel(sessionId: string): void {
    this.starts.delete(sessionId)
  }

  private encryptCookie(cookie: string): EncryptedCookie {
    if (!this.publicKey) throw new Error('Remote adapter public key is unavailable')
    const key = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()])
    const wrappedKey = publicEncrypt(
      {
        key: this.publicKey,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      key,
    )
    return {
      algorithm: 'AES-256-GCM+RSA-OAEP-SHA256',
      wrappedKey: wrappedKey.toString('base64url'),
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    }
  }

  private async send(
    path: string,
    body: string,
    controllerSignal: AbortSignal,
    allowed: () => boolean,
  ): Promise<unknown> {
    if (!allowed()) return null
    const timestamp = String(Math.floor(Date.now() / 1_000))
    const nonce = randomBytes(18).toString('base64url')
    const bodyHash = createHash('sha256').update(body).digest('hex')
    const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`
    const signature = createHmac('sha256', this.options.instanceSecret).update(canonical).digest('hex')
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs)
    const signal = AbortSignal.any([controllerSignal, timeoutSignal])
    const response = await this.fetcher(endpoint(this.options.url, path), {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-mt-instance': this.options.instanceId,
        'x-mt-timestamp': timestamp,
        'x-mt-nonce': nonce,
        'x-mt-signature': signature,
      },
      body,
    })
    if (!response.ok || !allowed()) return null
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }
}

const configured = config.kugouReportAdapter
export const remoteListeningWriter = configured.enabled
  ? new HttpRemoteListeningWriter({
      url: configured.url,
      instanceId: configured.instanceId,
      instanceSecret: configured.instanceSecret,
      cookiePublicKey: configured.cookiePublicKey,
      timeoutMs: configured.timeoutMs,
    })
  : undefined
