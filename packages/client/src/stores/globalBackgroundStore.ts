import { create } from 'zustand'
import type { ColorPreset } from '@music-together/shared'

interface GlobalBackgroundStore {
  backgroundUrl: string | null
  glassOverlay: boolean
  colorPreset: ColorPreset
  backgroundBrightness: number
  autoTint: boolean
  setBackgroundUrl: (backgroundUrl: string | null) => void
  setGlassOverlay: (glassOverlay: boolean) => void
  setColorPreset: (colorPreset: ColorPreset) => void
  setBackgroundBrightness: (backgroundBrightness: number) => void
  setAutoTint: (autoTint: boolean) => void
}

export const useGlobalBackgroundStore = create<GlobalBackgroundStore>((set) => ({
  backgroundUrl: null,
  glassOverlay: false,
  colorPreset: 'gold',
  backgroundBrightness: 60,
  autoTint: false,
  setBackgroundUrl: (backgroundUrl) => set({ backgroundUrl }),
  setGlassOverlay: (glassOverlay) => set({ glassOverlay }),
  setColorPreset: (colorPreset) => set({ colorPreset }),
  setBackgroundBrightness: (backgroundBrightness) => set({ backgroundBrightness }),
  setAutoTint: (autoTint) => set({ autoTint }),
}))
