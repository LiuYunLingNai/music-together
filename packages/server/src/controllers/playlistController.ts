import { EVENTS, platformEventSchema } from '@music-together/shared'
import type { MusicSource } from '@music-together/shared'
import * as authService from '../services/authService.js'
import { AUTH_PROVIDERS } from '../services/authProvider.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { logger } from '../utils/logger.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'

export function registerPlaylistController(io: TypedServer, socket: TypedSocket) {
  socket.on(EVENTS.PLAYLIST_GET_MY, async (data) => {
    // 校验平台；只要请求里带了平台名就一定回应，避免客户端一直等待
    const parsed = platformEventSchema.safeParse(data)
    if (!parsed.success) {
      const named = (data as { platform?: unknown } | null | undefined)?.platform
      if (typeof named === 'string') socket.emit(EVENTS.PLAYLIST_MY_LIST, { platform: named as MusicSource, playlists: [] })
      return
    }
    const { platform } = parsed.data

    let isCurrentRequest = () => socket.connected
    try {
      const mapping = roomRepo.getSocketMapping(socket.id)
      if (!mapping) {
        socket.emit(EVENTS.PLAYLIST_MY_LIST, { platform, playlists: [] })
        return
      }

      // 个人歌单只使用请求者自己的凭据；不得回退到房间共享账号，否则会把
      // VIP 账号主的私人歌单暴露给同房间成员。
      const cookie = authService.getUserCookie(mapping.userId, platform, mapping.roomId)
      if (!cookie) {
        socket.emit(EVENTS.PLAYLIST_MY_LIST, { platform, playlists: [] })
        return
      }

      const authorizationVersion = authService.getAuthorizationVersion(mapping.userId, platform, mapping.roomId)
      isCurrentRequest = () =>
        socket.connected &&
        roomRepo.getSocketMapping(socket.id) === mapping &&
        authService.getAuthorizationVersion(mapping.userId, platform, mapping.roomId) === authorizationVersion &&
        authService.getUserCookie(mapping.userId, platform, mapping.roomId) === cookie
      const playlists = await AUTH_PROVIDERS[platform].getUserPlaylists(cookie)
      if (!isCurrentRequest()) return
      socket.emit(EVENTS.PLAYLIST_MY_LIST, { platform, playlists })
    } catch (err) {
      logger.error('PLAYLIST_GET_MY error', err, { socketId: socket.id })
      if (!isCurrentRequest()) return
      socket.emit(EVENTS.PLAYLIST_MY_LIST, { platform, playlists: [] })
    }
  })
}
