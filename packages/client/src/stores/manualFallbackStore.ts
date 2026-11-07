import type { Track } from '@music-together/shared'
import { create } from 'zustand'

interface ManualFallbackState {
  track: Track | null
  open: (track: Track) => void
  close: () => void
}

export const useManualFallbackStore = create<ManualFallbackState>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}))
