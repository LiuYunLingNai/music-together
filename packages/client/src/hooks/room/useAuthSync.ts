import { useSocketContext } from '@/providers/socket-context'
import { consumeAutoResend } from '@/lib/authAutoResend'
import { storage } from '@/lib/storage'
import { EVENTS } from '@music-together/shared'
import type { MusicSource } from '@music-together/shared'
import { useEffect } from 'react'
import { toast } from 'sonner'

const PLATFORM_NAMES: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  bilibili: 'B站',
}

/**
 * Hook：认证结果处理（always-mounted 级别）
 *
 * 统一处理 AUTH_SET_COOKIE_RESULT 事件：
 * 1. localStorage 持久化（成功时保存 cookie）
 * 2. Toast 通知（区分用户操作 vs 自动恢复）
 *
 * 设计决策：
 * - Cookie 只通过 useAuth.logout() 删除，本 hook 永不删除
 * - 自动恢复（auto-resend）成功时静默（避免进房间时 N 条 toast）
 * - 自动恢复失败时提示一次（用 toast id 去重）
 */
export function useAuthSync() {
  const { socket } = useSocketContext()

  useEffect(() => {
    const onAuthCookieResult = (data: {
      success: boolean
      message: string
      platform?: MusicSource
      cookie?: string
      reason?: 'expired' | 'error' | 'reauth_required'
    }) => {
      if (data.success) {
        // 持久化 cookie
        if (data.platform && data.cookie) {
          storage.upsertAuthCookie(data.platform, data.cookie)
        }

        // 自动恢复成功时静默，手动操作时弹 toast
        if (!consumeAutoResend()) {
          toast.success(data.message)
        }
      } else if (data.platform) {
        const name = PLATFORM_NAMES[data.platform] ?? data.platform

        // 自动恢复失败时消费计数
        consumeAutoResend()

        if (data.reason === 'reauth_required') {
          storage.removeAuthCookie(data.platform)
          toast.warning(data.message, { id: `auth-reauth-${data.platform}` })
        } else if (data.reason === 'expired') {
          toast.warning(`${name} 登录验证失败，将在下次进入房间时重试`, { id: `auth-expired-${data.platform}` })
        } else if (data.reason === 'error') {
          toast.info(`${name} 登录验证失败，将在下次进入房间时重试`, { id: `auth-error-${data.platform}` })
        } else {
          // 手动操作失败
          toast.error(data.message)
        }
        // Cookie 永不删除 — 只有 useAuth.logout() 有权删除
      }
    }

    socket.on(EVENTS.AUTH_SET_COOKIE_RESULT, onAuthCookieResult)

    return () => {
      socket.off(EVENTS.AUTH_SET_COOKIE_RESULT, onAuthCookieResult)
    }
  }, [socket])
}
