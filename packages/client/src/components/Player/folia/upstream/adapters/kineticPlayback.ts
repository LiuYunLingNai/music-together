import { create } from 'zustand'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackStore as useHostPlaybackStore } from './hostRuntime'

export const getPlaybackSongKey = (song: { id?: string; source?: string; urlId?: string; name?: string } | null) =>
  song?.source && song.urlId ? `${song.source}:${song.urlId}` : song?.id ?? song?.name ?? null
type HostTrack = ReturnType<typeof usePlayerStore.getState>['currentTrack']
let songCache: { track: HostTrack; song: { id: string; name: string; source: string; urlId: string } | null } | undefined
const currentSong = (track: HostTrack) => {
  if (songCache?.track === track) return songCache.song
  const song = track ? { id: track.id, name: track.title, source: track.source, urlId: track.urlId } : null
  songCache = { track, song }
  return song
}
const snapshot = () => {
  const state = useHostPlaybackStore.getState()
  const track = usePlayerStore.getState().currentTrack
  return { currentSong: currentSong(track), lyrics: state.lines }
}
export const usePlaybackStore = create(snapshot)
useHostPlaybackStore.subscribe(() => usePlaybackStore.setState(snapshot()))
