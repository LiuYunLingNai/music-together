import pino from 'pino'

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
        colorize: isDev,
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
