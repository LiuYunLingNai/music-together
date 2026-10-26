import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/socket-context'
import type { MusicSource, MyPlatformAuth, PlatformAuthStatus, LocalQqAccount, SavedAccountSummary } from '@music-together/shared'
import { EVENTS, QR_STATUS } from '@music-together/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * Hook：管理平台认证 UI 状态
 *
 * 职责：
 * - QR 扫码登录状态（二维码数据、扫码状态、加载状态）
 * - 平台认证状态（聚合状态、个人状态）
 * - 用户操作方法（requestQrCode、setCookie、logout）
 *
 * 不负责：
 * - Cookie 持久化（由 useAuthSync 处理）
 * - Cookie 验证结果 toast（由 useAuthSync 处理）
 */
export function useAuth() {
  const { socket } = useSocketContext()
  const [platformStatus, setPlatformStatus] = useState<PlatformAuthStatus[]>([])
  const [myStatus, setMyStatus] = useState<MyPlatformAuth[]>([])
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [qrData, setQrData] = useState<{ key: string; qrimg: string } | null>(null)
  const [qrStatus, setQrStatus] = useState<{ status: number; message: string } | null>(null)
  const [isQrLoading, setIsQrLoading] = useState(false)
  const [isClaimingKugouConceptVip, setIsClaimingKugouConceptVip] = useState(false)
  const [qrPlatform, setQrPlatform] = useState<MusicSource>('netease')
  /** 该平台已保存的账号（仅展示信息），用于提供「继续使用」入口。 */
  const [savedAccount, setSavedAccount] = useState<SavedAccountSummary | null>(null)
  /** 本机 QQ 客户端已登录的账号列表（仅同机访问时有内容）。 */
  const [localQqAccounts, setLocalQqAccounts] = useState<LocalQqAccount[]>([])
  const [localQqAvailable, setLocalQqAvailable] = useState(false)
  const [isLocalQqLoggingIn, setIsLocalQqLoggingIn] = useState(false)
  const [isQuickLoggingIn, setIsQuickLoggingIn] = useState(false)

  // Ref 跟踪最新的 qrPlatform，避免重建回调导致重启轮询
  const qrPlatformRef = useRef<MusicSource>(qrPlatform)
  const qrKeyRef = useRef<string | null>(null)
  const qrCompletedRef = useRef(false)

  useEffect(() => {
    const onStatusUpdate = (data: PlatformAuthStatus[]) => {
      setPlatformStatus(data)
    }

    const onMyStatus = (data: MyPlatformAuth[]) => {
      setMyStatus(data)
      setStatusLoaded(true)
    }

    const onQrGenerated = (data: { key: string; qrimg: string; savedAccount?: SavedAccountSummary }) => {
      qrCompletedRef.current = false
      qrKeyRef.current = data.key
      setQrData(data)
      setSavedAccount(data.savedAccount ?? null)
      setQrStatus({ status: 801, message: '等待扫码' })
      setIsQrLoading(false)
    }

    const onQrStatus = (data: { status: number; message: string; key?: string }) => {
      if (qrCompletedRef.current) return
      if (data.key && data.key !== qrKeyRef.current) return
      if (data.status === QR_STATUS.SUCCESS || data.status === QR_STATUS.EXPIRED) {
        qrCompletedRef.current = true
        qrKeyRef.current = null
      }
      setQrStatus(data)
      if (data.status === QR_STATUS.SUCCESS || data.status === QR_STATUS.EXPIRED) {
        setIsQrLoading(false)
      }
    }

    const onKugouConceptVipClaim = (data: { success: boolean; message: string }) => {
      setIsClaimingKugouConceptVip(false)
      if (data.success) toast.success(data.message)
      else toast.error(data.message)
    }

    const onQuickLoginResult = (data: {
      success: boolean
      message: string
      nickname?: string
    }) => {
      setIsQuickLoggingIn(false)
      if (data.success) toast.success(data.message)
      else toast.error(data.message)
    }

    const onLocalQqAccounts = (data: { available: boolean; accounts: LocalQqAccount[] }) => {
      setLocalQqAvailable(data.available)
      setLocalQqAccounts(data.accounts)
    }

    const onLocalQqLoginResult = (data: { success: boolean; message: string }) => {
      setIsLocalQqLoggingIn(false)
      if (data.success) toast.success(data.message)
      else toast.error(data.message)
    }

    socket.on(EVENTS.AUTH_STATUS_UPDATE, onStatusUpdate)
    socket.on(EVENTS.AUTH_MY_STATUS, onMyStatus)
    socket.on(EVENTS.AUTH_QR_GENERATED, onQrGenerated)
    socket.on(EVENTS.AUTH_QR_STATUS, onQrStatus)
    socket.on(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, onKugouConceptVipClaim)
    socket.on(EVENTS.AUTH_QUICK_LOGIN_RESULT, onQuickLoginResult)
    socket.on(EVENTS.AUTH_LOCAL_QQ_ACCOUNTS, onLocalQqAccounts)
    socket.on(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, onLocalQqLoginResult)

    // 挂载时拉取当前状态（覆盖延迟挂载场景）
    socket.emit(EVENTS.AUTH_GET_STATUS)

    return () => {
      socket.off(EVENTS.AUTH_STATUS_UPDATE, onStatusUpdate)
      socket.off(EVENTS.AUTH_MY_STATUS, onMyStatus)
      socket.off(EVENTS.AUTH_QR_GENERATED, onQrGenerated)
      socket.off(EVENTS.AUTH_QR_STATUS, onQrStatus)
      socket.off(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT, onKugouConceptVipClaim)
      socket.off(EVENTS.AUTH_QUICK_LOGIN_RESULT, onQuickLoginResult)
      socket.off(EVENTS.AUTH_LOCAL_QQ_ACCOUNTS, onLocalQqAccounts)
      socket.off(EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT, onLocalQqLoginResult)
    }
  }, [socket])

  const requestQrCode = useCallback(
    (platform: MusicSource) => {
      setQrData(null)
      setSavedAccount(null)
      qrCompletedRef.current = false
      qrKeyRef.current = null
      setQrStatus(null)
      setIsQrLoading(true)
      setQrPlatform(platform)
      qrPlatformRef.current = platform
      socket.emit(EVENTS.AUTH_REQUEST_QR, { platform })
    },
    [socket],
  )

  const checkQrStatus = useCallback(
    (key: string) => {
      if (qrCompletedRef.current || qrKeyRef.current !== key) return
      socket.emit(EVENTS.AUTH_CHECK_QR, { key, platform: qrPlatformRef.current })
    },
    [socket],
  )

  const setCookie = useCallback(
    (platform: MusicSource, cookie: string) => {
      socket.emit(EVENTS.AUTH_SET_COOKIE, { platform, cookie })
    },
    [socket],
  )

  const logout = useCallback(
    (platform: MusicSource) => {
      storage.removeAuthCookie(platform)
      socket.emit(EVENTS.AUTH_LOGOUT, { platform })
    },
    [socket],
  )

  const resetQr = useCallback(() => {
    qrCompletedRef.current = true
    qrKeyRef.current = null
    setQrData(null)
    setQrStatus(null)
    setIsQrLoading(false)
  }, [])

  const claimKugouConceptVip = useCallback(() => {
    if (isClaimingKugouConceptVip) return
    setIsClaimingKugouConceptVip(true)
    socket.emit(EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP)
  }, [isClaimingKugouConceptVip, socket])

  /** 使用已保存的账号直接登录（免扫码）。 */
  const quickLogin = useCallback(
    (platform: MusicSource) => {
      if (isQuickLoggingIn) return
      setIsQuickLoggingIn(true)
      socket.emit(EVENTS.AUTH_QUICK_LOGIN, { platform })
    },
    [isQuickLoggingIn, socket],
  )

  /** 探测服务端所在机器上已登录的 QQ 客户端账号（仅同机访问有效）。 */
  const probeLocalQq = useCallback(() => {
    setLocalQqAvailable(false)
    setLocalQqAccounts([])
    socket.emit(EVENTS.AUTH_LOCAL_QQ_PROBE)
  }, [socket])

  /** 使用本机 QQ 客户端的某个账号完成一键登录。 */
  const loginWithLocalQq = useCallback(
    (uin: string) => {
      if (isLocalQqLoggingIn) return
      setIsLocalQqLoggingIn(true)
      socket.emit(EVENTS.AUTH_LOCAL_QQ_LOGIN, { uin })
    },
    [isLocalQqLoggingIn, socket],
  )

  /** 清空本机 QQ 探测结果（弹窗关闭时调用）。 */
  const resetLocalQq = useCallback(() => {
    setLocalQqAvailable(false)
    setLocalQqAccounts([])
  }, [])

  return {
    platformStatus,
    myStatus,
    statusLoaded,
    qrData,
    qrStatus,
    qrPlatform,
    isQrLoading,
    requestQrCode,
    checkQrStatus,
    setCookie,
    logout,
    resetQr,
    claimKugouConceptVip,
    isClaimingKugouConceptVip,
    // 快捷登录（已保存账号）
    savedAccount,
    isQuickLoggingIn,
    quickLogin,
    // 本机 QQ 一键登录
    localQqAccounts,
    localQqAvailable,
    isLocalQqLoggingIn,
    probeLocalQq,
    loginWithLocalQq,
    resetLocalQq,
  }
}
