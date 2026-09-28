import { create } from 'zustand'
import type { Track, UserPlaylist } from '@music-together/shared'

interface AccountPlaylistState {
  /** 已缓存的本地歌单元数据列表。 */
  playlists: UserPlaylist[]
  /** 是否已成功拉取过一次列表。 */
  loaded: boolean
  loading: boolean
  /** 「加入歌单」选择器待添加的曲目；非空即表示选择器已打开。 */
  pickerTracks: Track[] | null
  /** 选择器标题（用于区分单曲 / 整个队列）。 */
  pickerLabel: string | null
  setPlaylists: (playlists: UserPlaylist[]) => void
  upsertPlaylist: (playlist: UserPlaylist) => void
  removePlaylist: (id: string) => void
  setLoading: (loading: boolean) => void
  openPicker: (tracks: Track[], label?: string) => void
  closePicker: () => void
  reset: () => void
}

export const useAccountPlaylistStore = create<AccountPlaylistState>((set) => ({
  playlists: [],
  loaded: false,
  loading: false,
  pickerTracks: null,
  pickerLabel: null,
  setPlaylists: (playlists) => set({ playlists, loaded: true, loading: false }),
  upsertPlaylist: (playlist) =>
    set((state) => {
      const rest = state.playlists.filter((item) => item.id !== playlist.id)
      return { playlists: [playlist, ...rest] }
    }),
  removePlaylist: (id) => set((state) => ({ playlists: state.playlists.filter((item) => item.id !== id) })),
  setLoading: (loading) => set({ loading }),
  openPicker: (tracks, label) => set({ pickerTracks: tracks, pickerLabel: label ?? null }),
  closePicker: () => set({ pickerTracks: null, pickerLabel: null }),
  reset: () => set({ playlists: [], loaded: false, loading: false, pickerTracks: null, pickerLabel: null }),
}))
