import type { Track } from '@music-together/shared'

export interface ListeningDeck {
  node: HTMLMediaElement
  track: Track
  playing: boolean
  instance: object
}

export interface LocalOutput {
  revision: number
  stems: boolean
  decks: ListeningDeck[]
}

export { SoloPlaybackClock as LocalListeningProgress } from '@music-together/shared'

interface PageListen {
  seconds: number
  previous: number | null
  verifiedPrevious?: number
}
let snapshot: PageListen | null = null
const listeners = new Set<() => void>()

export const pageListening = {
  read: () => snapshot,
  subscribe(callback: () => void) {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  },
  publish(value: PageListen | null) {
    if (
      snapshot?.seconds === value?.seconds &&
      snapshot?.previous === value?.previous &&
      snapshot?.verifiedPrevious === value?.verifiedPrevious
    )
      return
    snapshot = value
    for (const callback of listeners) callback()
  },
}
