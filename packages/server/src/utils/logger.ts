import { spawnSync } from 'node:child_process'
import pino from 'pino'

// Windows 控制台默认代码页为 936（GBK），会把 UTF-8 中文日志显示为乱码；
// 启动时切换为 65001（UTF-8），仅在交互式终端下尝试，失败不影响服务运行。
if (process.platform === 'win32' && process.stdout.isTTY) {
  try {
    spawnSync('chcp', ['65001'], { stdio: 'ignore' })
  } catch {
    // 忽略：部分受限环境无 chcp 命令，日志仍可输出，仅显示受影响
  }
}

const isDev = process.env.NODE_ENV !== 'production'
const useJson = process.env.LOG_FORMAT?.toLowerCase() === 'json'

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  redact: {
    paths: ['password', 'cookie', 'authorization', 'token', '*.password', '*.cookie', '*.authorization', '*.token'],
    censor: '[已隐藏]',
  },
  ...(!useJson && {
    transport: {
      target: 'pino-pretty',
      options: {
        // 仅在交互式终端着色，避免重定向到文件时残留 ANSI 转义码（如 [39m）
        colorize: isDev && Boolean(process.stdout.isTTY),
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        singleLine: true,
        levelFirst: true,
        hideObject: false,
      },
    },
  }),
})

/**
 * Logger wrapper that keeps the same call signature as our previous hand-rolled logger.
 * All existing call sites (10+ files) need zero changes.
 *
 * Signatures:
 *   logger.debug(message, context?)
 *   logger.info(message, context?)
 *   logger.warn(message, context?)
 *   logger.error(message, err?, context?)
 */
export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    baseLogger.debug(context ?? {}, message)
  },
  info(message: string, context?: Record<string, unknown>) {
    baseLogger.info(context ?? {}, message)
  },
  warn(message: string, context?: Record<string, unknown>) {
    baseLogger.warn(context ?? {}, message)
  },
  error(message: string, err?: unknown, context?: Record<string, unknown>) {
    const errObj = err instanceof Error ? err : undefined
    const extra = { ...context, ...(err && !(err instanceof Error) ? { error: String(err) } : {}) }
    baseLogger.error({ ...extra, err: errObj }, message)
  },
}
