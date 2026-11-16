import type { Howl } from 'howler'
import type { KugouListeningReport } from '@music-together/shared'
import { SERVER_URL } from './config'

function createSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // getRandomValues also works on HTTP LAN deployments where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Count recent, continuous playback only. Gaps and discontinuities are deliberately undercounted. */
export class ListeningClock {
  totalMs = 0
  private last: { position: number; at: number; playing: boolean } | null = null

  reset() {
    this.last = null
  }

  sample(position: number, playing: boolean, at: number) {
    const previous = this.last
    this.last = Number.isFinite(position) ? { position, playing, at } : null
    if (!previous || !this.last || !previous.playing || !playing) return
    const elapsed = at - previous.at
    const advanced = (position - previous.position) * 1000
    if (elapsed <= 0 || elapsed > 5000 || advanced <= 0 || advanced > elapsed * 1.1 + 100) return
    this.totalMs += Math.min(elapsed, advanced)
  }
}

/** One tracker per Howl. All reports are ordered; uncertain writes are never retried. */
export function createKugouListeningTracker(roomId: string, trackId: string, getHowl: () => Howl) {
  const clock = new ListeningClock()
  const sessionId = createSessionId()
  let started = false
  let disposed = false
  let disabled = false
  let timer: ReturnType<typeof setInterval> | undefined
  let chain = Promise.resolve()
  let lastReportAt = 0
  let media: HTMLMediaElement | undefined

  const reset = () => clock.reset()
  const sample = () => {
    const howl = getHowl()
    const playing = howl.playing() && !media?.seeking && (!media || media.readyState >= 3)
    clock.sample(howl.seek() as number, playing, performance.now())
  }
  const send = (ended = false, flush = false) => {
    const report: KugouListeningReport = {
      roomId,
      trackId,
      sessionId,
      listenedMs: Math.floor(clock.totalMs),
      ended,
      flush,
    }
    chain = chain.then(async () => {
      if (disabled) return
      try {
        const response = await fetch(`${SERVER_URL}/api/music/kugou-listening`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
          keepalive: ended,
          signal: AbortSignal.timeout(25_000),
        })
        if (!response.ok) {
          disabled = true
          return
        }
        const result = (await response.json()) as { status?: string }
        if (['not_logged_in', 'invalid_session', 'unavailable'].includes(result.status ?? '')) disabled = true
        if (result.status === 'upstream_unavailable') {
          console.warn('酷狗听歌时长同步暂不可用，本次增量不会重试')
        }
      } catch {
        // Stop this session after an uncertain delivery. A new track can start a new session.
        disabled = true
      }
    })
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (timer) clearInterval(timer)
    if (started) {
      sample()
      send(true)
    }
    media?.removeEventListener('seeking', reset)
    media?.removeEventListener('seeked', reset)
    window.removeEventListener('pagehide', dispose)
  }
  return {
    play() {
      if (disposed || disabled) return
      if (!started) {
        started = true
        // All tracks use Howler HTML5 audio. Native seeking also covers direct sync corrections.
        const internal = getHowl() as unknown as { _sounds?: { _node?: HTMLMediaElement }[] }
        media = internal._sounds?.[0]?._node
        media?.addEventListener('seeking', reset)
        media?.addEventListener('seeked', reset)
        window.addEventListener('pagehide', dispose)
        lastReportAt = performance.now()
        send()
        timer = setInterval(() => {
          if (disabled) {
            if (timer) clearInterval(timer)
            return
          }
          sample()
          if (performance.now() - lastReportAt >= 15_000) {
            lastReportAt = performance.now()
            send()
          }
        }, 1000)
      }
      reset()
      sample()
    },
    pause() {
      reset()
      if (started && !disposed) send(false, true)
    },
    seek: reset,
    dispose,
  }
}
