import { registerRoomController } from './roomController.js'
import { registerPlayerController } from './playerController.js'
import { registerQueueController } from './queueController.js'
import { registerChatController } from './chatController.js'
import { registerVoteController } from './voteController.js'
import { registerAuthController } from './authController.js'
import { registerPlaylistController } from './playlistController.js'
import { logger } from '../utils/logger.js'
import type { TypedServer } from '../middleware/types.js'
import { EVENTS } from '@music-together/shared'
import { audioProxyPolicyRepo } from '../repositories/audioProxyPolicyRepository.js'

export function initializeSocket(io: TypedServer) {
  io.on('connection', (socket) => {
    logger.debug('客户端已连接', { socketId: socket.id })

    // 新连接默认加入 lobby 频道（首页房间列表推送）
    socket.join('lobby')
    socket.emit(EVENTS.SERVER_AUDIO_PROXY_POLICY, audioProxyPolicyRepo.get())

    registerRoomController(io, socket)
    registerPlayerController(io, socket)
    registerQueueController(io, socket)
    registerChatController(io, socket)
    registerVoteController(io, socket)
    registerAuthController(io, socket)
    registerPlaylistController(io, socket)
  })

  logger.info('实时通信服务已初始化')
}
