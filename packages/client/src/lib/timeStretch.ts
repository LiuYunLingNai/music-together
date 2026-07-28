import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'
import { Howler } from 'howler'
import type { Howl } from 'howler'

const MIN_TEMPO = 0.99
const MAX_TEMPO = 1.01
const CORS_AUDIO_HOST_SUFFIXES = ['music.126.net', 'music.163.com', 'qqmusic.qq.com', 'kugou.com', 'kugou.net']

interface InternalHowl extends Howl {
  _sounds?: Array<{ _node?: HTMLMediaElement }>
}

interface InternalHowler {
  _obtainHtml5Audio: () => HTMLAudioElement
}

interface StretchGraph {
  audio: HTMLMediaElement
  source: MediaElementAudioSourceNode
  node: SoundTouchNode
  context: AudioContext
  bypassed: boolean
  metricsSnapshots: number
  lastBlockCount: number
  lastUnderrunCount: number
}

export interface TimeStretchController {
  readonly enabled: boolean
  setTempo: (tempo: number) => void
  reset: () => void
}

const graphByAudio = new WeakMap<HTMLMediaElement, StretchGraph>()
const registrationByContext = new WeakMap<BaseAudioContext, Promise<void>>()
let nextAudioUsesCors = false
let obtainAudioPatched = false

/**
 * Howler has no public option for HTMLMediaElement.crossOrigin. Patch its
 * element factory once and mark the next synchronously-created element for
 * anonymous CORS before Howler assigns the direct CDN URL.
 */
export function prepareDirectStreamForTimeStretch(streamUrl: string): boolean {
  let supportsCors = false
  try {
    const hostname = new URL(streamUrl).hostname.toLowerCase()
    supportsCors = CORS_AUDIO_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  } catch {
    supportsCors = false
  }

  const internalHowler = Howler as unknown as InternalHowler
  if (!obtainAudioPatched) {
    const obtainHtml5Audio = internalHowler._obtainHtml5Audio
    internalHowler._obtainHtml5Audio = function () {
      const audio = obtainHtml5Audio.call(this)
      if (nextAudioUsesCors) audio.crossOrigin = 'anonymous'
      else audio.removeAttribute('crossorigin')
      nextAudioUsesCors = false
      return audio
    }
    obtainAudioPatched = true
  }
  nextAudioUsesCors = supportsCors
  return supportsCors
}

function getAudioElement(howl: Howl): HTMLMediaElement | null {
  const sound = (howl as InternalHowl)._sounds?.[0]
  return sound?._node ?? null
}

function registerProcessor(context: AudioContext): Promise<void> {
  const existing = registrationByContext.get(context)
  if (existing) return existing
  const registration = SoundTouchNode.register(context, processorUrl)
  registrationByContext.set(context, registration)
  return registration
}

function disableGraph(graph: StretchGraph): void {
  if (graph.bypassed) return
  graph.bypassed = true
  graph.node.disconnect()
  graph.source.disconnect()
  graph.source.connect(graph.context.destination)
  graph.audio.playbackRate = 1
}

/**
 * Attach SoundTouch's WSOLA AudioWorklet to Howler's HTML5 media element.
 * The returned controller is intentionally fail-closed: if the browser does
 * not support AudioWorklet or the processor underruns, native 1.0x playback
 * is restored instead of producing malformed audio.
 */
export async function attachTimeStretch(howl: Howl): Promise<TimeStretchController | null> {
  if (typeof AudioContext === 'undefined') return null
  const audio = getAudioElement(howl)
  if (!audio) return null

  const existing = graphByAudio.get(audio)
  if (existing) {
    return createController(existing)
  }

  const context = Howler.ctx
  if (!context) return null
  let source: MediaElementAudioSourceNode | null = null

  try {
    await registerProcessor(context)
    source = context.createMediaElementSource(audio)
    const node = new SoundTouchNode({ context, interpolationStrategy: 'lanczos' })
    node.setStretchParameters({ sequenceMs: 80, seekWindowMs: 20, overlapMs: 12, quickSeek: true })
    node.pitch.value = 1
    source.connect(node)
    node.connect(context.destination)

    const graph: StretchGraph = {
      audio,
      source,
      node,
      context,
      bypassed: false,
      metricsSnapshots: 0,
      lastBlockCount: 0,
      lastUnderrunCount: 0,
    }
    graphByAudio.set(audio, graph)
    node.addEventListener('metrics', () => {
      const metrics = node.metrics
      if (!metrics) return
      graph.metricsSnapshots++
      const blockDelta = metrics.blockCount - graph.lastBlockCount
      const underrunDelta = metrics.underrunCount - graph.lastUnderrunCount
      graph.lastBlockCount = metrics.blockCount
      graph.lastUnderrunCount = metrics.underrunCount

      // WSOLA needs a short initial buffer, so startup underruns are expected.
      // After warm-up, sustained gaps indicate that this device cannot keep up.
      if (graph.metricsSnapshots > 3 && blockDelta > 0 && underrunDelta / blockDelta > 0.02) {
        disableGraph(graph)
      }
    })
    return createController(graph)
  } catch (error) {
    if (source) source.connect(context.destination)
    audio.playbackRate = 1
    console.warn('Time-stretch processor unavailable; keeping native 1.0x audio', error)
    return null
  }
}

function createController(graph: StretchGraph): TimeStretchController {
  return {
    get enabled() {
      return !graph.bypassed
    },
    setTempo: (tempo) => {
      if (graph.bypassed) return
      const clamped = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, tempo))
      graph.audio.playbackRate = clamped
      graph.node.playbackRate.setValueAtTime(clamped, graph.context.currentTime)
    },
    reset: () => {
      graph.audio.playbackRate = 1
      graph.node.playbackRate.setValueAtTime(1, graph.context.currentTime)
    },
  }
}
