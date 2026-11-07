import { create } from 'zustand'
import type { MusicSource, Track } from '@music-together/shared'
import type { LyricLine, LyricOrigin } from '@/lib/lyricPresentation'
import { storage } from '@/lib/storage'

interface PlayerStore {
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  lyric: string
  tlyric: string
  ttmlLines: LyricLine[] | null
  lyricLoading: boolean
  /** Where the lines currently shown came from, for diagnostics and the settings summary. */
  lyricOrigin: LyricOrigin | null
  lyricProvider: MusicSource | null
  lyricConfidence: number | null
  /** Temporary lyric offset while the calibration slider is being dragged. */
  lyricOffsetPreview: { key: string; offsetMs: number } | null
  syncDrift: number

  setCurrentTrack: (track: Track | null) => void
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setLyric: (lyric: string, tlyric?: string) => void
  setTtmlLines: (lines: LyricLine[] | null) => void
  setLyricLoading: (loading: boolean) => void
  setLyricProvenance: (origin: LyricOrigin | null, provider: MusicSource | null, confidence: number | null) => void
  setLyricOffsetPreview: (preview: { key: string; offsetMs: number } | null) => void
  setSyncDrift: (drift: number) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: storage.getVolume(),
  lyric: '',
  tlyric: '',
  ttmlLines: null,
  lyricLoading: false,
  lyricOrigin: null,
  lyricProvider: null,
  lyricConfidence: null,
  lyricOffsetPreview: null,
  syncDrift: 0,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => {
    storage.setVolume(volume)
    set({ volume })
  },
  setLyric: (lyric, tlyric) => set({ lyric, tlyric: tlyric ?? '' }),
  setTtmlLines: (lines) => set({ ttmlLines: lines }),
  setLyricLoading: (loading) => set({ lyricLoading: loading }),
  setLyricProvenance: (lyricOrigin, lyricProvider, lyricConfidence) =>
    set({ lyricOrigin, lyricProvider, lyricConfidence }),
  setLyricOffsetPreview: (preview) => set({ lyricOffsetPreview: preview }),
  setSyncDrift: (drift) => set({ syncDrift: drift }),
  reset: () =>
    set({
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      lyric: '',
      tlyric: '',
      ttmlLines: null,
      lyricLoading: false,
      lyricOrigin: null,
      lyricProvider: null,
      lyricConfidence: null,
      lyricOffsetPreview: null,
      syncDrift: 0,
    }),
}))
