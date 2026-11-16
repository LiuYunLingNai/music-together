import type { PlaybackFailureEvent } from '@music-together/shared'
import { create } from 'zustand'

interface PlaybackFailureState {
  failure: PlaybackFailureEvent | null
  show: (failure: PlaybackFailureEvent) => void
  dismiss: () => void
}

export const usePlaybackFailureStore = create<PlaybackFailureState>((set) => ({
  failure: null,
  show: (failure) => set({ failure }),
  dismiss: () => set({ failure: null }),
}))
