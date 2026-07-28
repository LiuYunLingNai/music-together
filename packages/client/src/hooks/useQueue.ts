import { useCallback } from 'react'
import { EVENTS, LIMITS, type Track } from '@music-together/shared'
import { useSocketContext } from '@/providers/socket-context'

export function useQueue() {
  const { socket } = useSocketContext()

  const addTrack = useCallback((track: Track) => socket.emit(EVENTS.QUEUE_ADD, { track }), [socket])

  const insertAfterCurrent = useCallback(
    (track: Track) => socket.emit(EVENTS.QUEUE_INSERT_AFTER_CURRENT, { track }),
    [socket],
  )

  const addBatchTracks = useCallback(
    (tracks: Track[], playlistName?: string) => {
      for (let offset = 0; offset < tracks.length; offset += LIMITS.QUEUE_BATCH_MAX_SIZE) {
        socket.emit(EVENTS.QUEUE_ADD_BATCH, {
          tracks: tracks.slice(offset, offset + LIMITS.QUEUE_BATCH_MAX_SIZE),
          playlistName,
        })
      }
    },
    [socket],
  )

  const removeTrack = useCallback((trackId: string) => socket.emit(EVENTS.QUEUE_REMOVE, { trackId }), [socket])

  const reorderTracks = useCallback((trackIds: string[]) => socket.emit(EVENTS.QUEUE_REORDER, { trackIds }), [socket])

  const updateBilibiliMetadata = useCallback(
    (
      trackId: string,
      metadata:
        | { metadataSource: 'netease' | 'tencent'; lyricId?: string; picId?: string; cover: string }
        | { clearMetadata: true },
    ) => socket.emit(EVENTS.QUEUE_UPDATE_METADATA, { trackId, ...metadata }),
    [socket],
  )

  const clearQueue = useCallback(() => socket.emit(EVENTS.QUEUE_CLEAR), [socket])

  return {
    addTrack,
    insertAfterCurrent,
    addBatchTracks,
    removeTrack,
    reorderTracks,
    updateBilibiliMetadata,
    clearQueue,
  }
}
