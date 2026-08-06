import type { ClientToServerEvents, ServerToClientEvents } from '@music-together/shared'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TypedServer } from './wss.js'
import { config } from './config.js'
import { initializeSocket } from './controllers/index.js'
import { identityHttpMiddleware } from './middleware/identityHttp.js'
import { attachSocketIdentity } from './middleware/socketIdentity.js'
import type { SocketData } from './middleware/types.js'
import authRoutes from './routes/auth.js'
import { createAdminRoutes } from './routes/admin.js'
import { createAccountRoutes } from './routes/account.js'
import musicRoutes from './routes/music.js'
import roomRoutes from './routes/rooms.js'
import { clearAllTimers } from './services/roomLifecycleService.js'
import * as playerService from './services/playerService.js'
import { logger } from './utils/logger.js'
import { databasePath } from './repositories/database.js'

const app = express()
const httpServer = createServer(app)
const io = new TypedServer<ClientToServerEvents, ServerToClientEvents, SocketData>(httpServer)

// HTTP API CORS: in auto mode we allow the browser-reported origin and rely on
// the cookie / same-host socket checks for deployment safety. This keeps local
// dev (localhost) and LAN access working consistently.
app.use(
  cors({
    origin: config.explicitOrigins.length > 0 ? config.explicitOrigins : (true as const),
    credentials: true,
  }),
)
app.use(express.json({ limit: '7mb' }))
app.use('/api', identityHttpMiddleware)
app.use('/uploads/avatars', express.static(path.join(path.dirname(databasePath), 'avatars'), { maxAge: '1h' }))

// REST API routes
app.use('/api/auth', authRoutes)
app.use('/api/auth', createAccountRoutes(io))
app.use('/api/admin', createAdminRoutes(io))
app.use('/api/music', musicRoutes)
app.use('/api/rooms', roomRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Version check (client polls on startup to detect updates)
app.get('/api/version', (_req, res) => {
  res.json({ version: config.version })
})

// --- Serve client SPA (条件挂载，仅当构建产物存在时) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(__dirname, '../../client/dist')
const indexHtml = path.join(clientDist, 'index.html')

if (fs.existsSync(indexHtml)) {
  // Vite 产物带 content hash -> 长缓存
  app.use(
    '/assets',
    express.static(path.join(clientDist, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }),
  )
  // 其他静态文件 (favicon, manifest 等)。index.html 不缓存，确保部署后立即生效
  app.use(
    express.static(clientDist, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate')
        }
      },
    }),
  )
  // SPA fallback: 所有非 API 的 GET -> index.html
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.sendFile(indexHtml)
  })
  logger.info('客户端静态页面已加载', { clientDist })
} else {
  logger.info('未发现客户端构建产物，已跳过静态页面托管（开发模式）')
}

attachSocketIdentity(io)
initializeSocket(io)

// Keep permanent-room playback position durable while a track is playing.
const playbackPersistenceTimer = setInterval(() => playerService.persistPlaybackSnapshots(), 5_000)
playbackPersistenceTimer.unref()

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} already in use`)
    process.exit(1)
  }
  throw err
})

httpServer.listen(config.port, () => {
  logger.info(`服务器已启动，监听端口 ${config.port}`, {
    event: 'server.started',
    port: config.port,
    environment: config.isProd ? 'production' : 'development',
    version: config.version,
  })
  logger.info(
    config.explicitOrigins.length > 0
      ? `仅允许以下来源连接：${config.explicitOrigins.join(', ')}`
      : '当前允许所有来源连接（自动模式）',
  )
})

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`收到 ${signal} 信号，正在安全关闭服务器……`)
  clearInterval(playbackPersistenceTimer)
  playerService.persistPlaybackSnapshots()
  clearAllTimers()
  io.close(() => {
    httpServer.close(() => {
      logger.info('服务器已关闭')
      process.exit(0)
    })
  })
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
