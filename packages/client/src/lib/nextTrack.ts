import type { RoomState, Track } from '@music-together/shared'

/** 客户端镜像 `queueService.getNextTrack`；shuffle 由服务端随机，不猜。 */
export function predictNextTrack(room: RoomState | null): Track | null {
  if (!room || room.queue.length === 0) return null
  const currentIndex = room.currentTrack ? room.queue.findIndex((track) => track.id === room.currentTrack?.id) : -1
  if (room.playMode === 'loop-one') return room.currentTrack ?? room.queue[0] ?? null
  if (room.playMode === 'shuffle') return null
  const nextIndex = currentIndex + 1
  if (nextIndex < room.queue.length) return room.queue[nextIndex] ?? null
  return room.playMode === 'loop-all' ? (room.queue[0] ?? null) : null
}
