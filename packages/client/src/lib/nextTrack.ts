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

/** 预取窗口：按队列顺序往后看 N 首；shuffle 不可预测，loop-one 只重复当前曲。 */
export function predictUpcomingTracks(room: RoomState | null, count: number): Track[] {
  if (!room || room.queue.length === 0 || count <= 0) return []
  if (room.playMode === 'loop-one') return room.currentTrack ? [room.currentTrack] : []
  if (room.playMode === 'shuffle') return []
  const currentIndex = room.currentTrack ? room.queue.findIndex((track) => track.id === room.currentTrack?.id) : -1
  const loop = room.playMode === 'loop-all'
  const result: Track[] = []
  let index = currentIndex
  for (let step = 0; step < count; step += 1) {
    index += 1
    if (index >= room.queue.length) {
      if (!loop) break
      index = 0
    }
    const track = room.queue[index]
    if (!track || result.some((item) => item.id === track.id)) break
    result.push(track)
  }
  return result
}

/** 预取窗口：队列里的上一首；循环列表会绕到队尾。 */
export function predictPreviousTrack(room: RoomState | null): Track | null {
  if (!room || room.queue.length === 0) return null
  if (room.playMode === 'shuffle') return null
  const currentIndex = room.currentTrack ? room.queue.findIndex((track) => track.id === room.currentTrack?.id) : -1
  if (currentIndex > 0) return room.queue[currentIndex - 1] ?? null
  return room.playMode === 'loop-all' ? (room.queue.at(-1) ?? null) : null
}
