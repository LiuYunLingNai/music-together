import { afterEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from '@/stores/playerStore'
import { getPlaybackSongKey, usePlaybackStore } from './kineticPlayback'

afterEach(() => usePlayerStore.getState().reset())

describe('kinetic playback adapter', () => {
  it('keeps the song reference stable when only the playback clock changes', () => {
    usePlayerStore.getState().setCurrentTrack({ id: 'queue-a', title: 'Song', artist: [], album: '', cover: '', duration: 100, source: 'netease', sourceId: '1', urlId: '1' })
    const song = usePlaybackStore.getState().currentSong
    usePlayerStore.setState({ currentTime: 12 })
    expect(usePlaybackStore.getState().currentSong).toBe(song)
    usePlayerStore.setState({ currentTrack: { ...usePlayerStore.getState().currentTrack!, id: 'queue-b' } })
    expect(usePlaybackStore.getState().currentSong).not.toBe(song)
    expect(getPlaybackSongKey(usePlaybackStore.getState().currentSong)).toBe(getPlaybackSongKey(song))
  })

  it('separates identical provider IDs from different sources', () => {
    expect(getPlaybackSongKey({ id: 'queue-a', source: 'netease', urlId: '1' })).toBe('netease:1')
    expect(getPlaybackSongKey({ id: 'queue-a', source: 'tencent', urlId: '1' })).toBe('tencent:1')
    expect(getPlaybackSongKey(null)).toBeNull()
  })
})
