import { create } from 'zustand'
import type { MusicSource } from '@music-together/shared'

/** 要打开的歌手：曲目带平台 ID 时按 ID，否则按名字查找。 */
export interface ArtistTarget {
  source: MusicSource
  id?: string
  name: string
}

interface ArtistPageStore {
  target: ArtistTarget | null
  open: (target: ArtistTarget) => void
  close: () => void
}

/** 全局唯一的歌手页，无论从歌曲、队列、播放器还是搜索打开。 */
export const useArtistPageStore = create<ArtistPageStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))

export function openArtistPage(target: ArtistTarget): void {
  useArtistPageStore.getState().open(target)
}
