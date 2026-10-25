import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { PLATFORM_LABELS } from '@/lib/platform'
import type { LocalQqAccount, MusicSource, SavedAccountSummary } from '@music-together/shared'
import { QR_STATUS, QR_TIMING } from '@music-together/shared'
import { Loader2, RefreshCw, CheckCircle2, AlertCircle, Smartphone, Zap } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface QrLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: MusicSource
  qrData: { key: string; qrimg: string } | null
  qrStatus: { status: number; message: string } | null
  isLoading: boolean
  onRefresh: () => void
  onCheckStatus: (key: string) => void
  // 快捷登录（已保存账号）
  savedAccount?: SavedAccountSummary | null
  isQuickLoggingIn?: boolean
  onQuickLogin?: (platform: MusicSource) => void
  // 本机 QQ 一键登录（仅 tencent 平台、同机访问时有内容）
  localQqAccounts?: LocalQqAccount[]
  localQqAvailable?: boolean
  isLocalQqLoggingIn?: boolean
  onLoginLocalQq?: (uin: string) => void
}

export function QrLoginDialog({
  open,
  onOpenChange,
  platform,
  qrData,
  qrStatus,
  isLoading,
  onRefresh,
  onCheckStatus,
  savedAccount,
  isQuickLoggingIn = false,
  onQuickLogin,
  localQqAccounts = [],
  localQqAvailable = false,
  isLocalQqLoggingIn = false,
  onLoginLocalQq,
}: QrLoginDialogProps) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollPendingAtRef = useRef<number>(0)
  const onOpenChangeRef = useRef(onOpenChange)
  const onCheckStatusRef = useRef(onCheckStatus)
  const label = PLATFORM_LABELS[platform] ?? platform
  const scanApp = platform === 'tencent' ? '手机QQ' : `${label} App`
  const pollingStopped = qrStatus?.status === QR_STATUS.EXPIRED || qrStatus?.status === QR_STATUS.SUCCESS

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    onCheckStatusRef.current = onCheckStatus
  }, [onCheckStatus])

  // Auto-poll QR status every 2 seconds when dialog is open and QR is generated
  useEffect(() => {
    if (!open || !qrData?.key || pollingStopped) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    pollPendingAtRef.current = 0
    const poll = () => {
      const now = Date.now()
      if (pollPendingAtRef.current > 0 && now - pollPendingAtRef.current < 8_000) return
      pollPendingAtRef.current = now
      onCheckStatusRef.current(qrData.key)
    }
    poll()
    pollRef.current = setInterval(poll, QR_TIMING.POLL_INTERVAL_MS)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [open, qrData?.key, pollingStopped])

  // On success or expiry: stop polling immediately + auto-close on success
  useEffect(() => {
    pollPendingAtRef.current = 0
    const status = qrStatus?.status
    if (status === QR_STATUS.EXPIRED || status === QR_STATUS.SUCCESS) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    if (status === QR_STATUS.SUCCESS) {
      const t = setTimeout(() => onOpenChangeRef.current(false), QR_TIMING.SUCCESS_CLOSE_DELAY_MS)
      return () => clearTimeout(t)
    }
  }, [qrStatus?.status])

  const statusCode = qrStatus?.status ?? 0
  const hasQuickOptions = Boolean(savedAccount) || (platform === 'tencent' && localQqAvailable)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}账号登录</DialogTitle>
          <DialogDescription>
            使用{scanApp}扫码，或选择下方已保存 / 本机账号快捷登录
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* 快捷登录：已保存账号 */}
          {savedAccount && (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Avatar size="lg">
                {savedAccount.avatarUrl ? (
                  <AvatarImage src={savedAccount.avatarUrl} alt={savedAccount.nickname} />
                ) : null}
                <AvatarFallback>{savedAccount.nickname.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{savedAccount.nickname}</span>
                  {savedAccount.vipLabel ? (
                    <Badge variant="secondary" className="shrink-0">
                      {savedAccount.vipLabel}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground truncate text-xs">已保存的账号，可一键继续登录</p>
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isQuickLoggingIn}
                onClick={() => onQuickLogin?.(platform)}
              >
                {isQuickLoggingIn ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                继续使用
              </Button>
            </div>
          )}

          {/* 本机 QQ 一键登录（仅 tencent + 同机访问） */}
          {platform === 'tencent' && localQqAvailable && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">本机 QQ 已登录，点击即可一键登录：</p>
              {localQqAccounts.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {localQqAccounts.map((acc) => (
                    <button
                      key={acc.uin}
                      type="button"
                      disabled={isLocalQqLoggingIn}
                      onClick={() => onLoginLocalQq?.(acc.uin)}
                      className="flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Avatar size="default">
                        <AvatarImage src={acc.avatarUrl} alt={acc.nickname} />
                        <AvatarFallback>{acc.nickname.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{acc.nickname}</p>
                        <p className="text-muted-foreground truncate text-xs">{acc.uin}</p>
                      </div>
                      {isLocalQqLoggingIn ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">未检测到本机已登录的 QQ 客户端，请改用扫码登录。</p>
              )}
            </div>
          )}

          {hasQuickOptions && <Separator />}

          {/* QR Code */}
          <div className="relative flex h-52 w-52 items-center justify-center self-center rounded-lg border bg-white">
            {isLoading && <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />}
            {!isLoading && qrData?.qrimg && (
              <>
                <img
                  src={qrData.qrimg}
                  alt={`${label}登录二维码`}
                  className="h-full w-full rounded-lg object-contain p-2"
                />
                {/* Overlay for expired/success */}
                {statusCode === QR_STATUS.EXPIRED && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60">
                    <AlertCircle className="mb-2 h-8 w-8 text-white" />
                    <p className="px-4 text-center text-sm text-white">{qrStatus?.message || '二维码已过期'}</p>
                  </div>
                )}
                {statusCode === QR_STATUS.SUCCESS && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-green-600/80">
                    <CheckCircle2 className="mb-2 h-8 w-8 text-white" />
                    <p className="text-sm text-white">登录成功</p>
                  </div>
                )}
              </>
            )}
            {!isLoading && !qrData && <p className="text-muted-foreground text-sm">生成二维码失败</p>}
          </div>

          {/* Status message */}
          <div className="flex items-center justify-center gap-2 text-sm">
            {statusCode === QR_STATUS.WAITING_SCAN && (
              <>
                <Smartphone className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground">打开{scanApp}扫码</span>
              </>
            )}
            {statusCode === QR_STATUS.SCANNED && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-blue-600">已扫码，请在手机上确认</span>
              </>
            )}
            {statusCode === QR_STATUS.SUCCESS && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-green-600">登录成功！</span>
              </>
            )}
            {statusCode === QR_STATUS.EXPIRED && (
              <>
                <AlertCircle className="text-destructive h-4 w-4" />
                <span className="text-destructive">{qrStatus?.message || '二维码已过期'}</span>
              </>
            )}
          </div>

          {/* Refresh button */}
          {(statusCode === QR_STATUS.EXPIRED || (!qrData && !isLoading)) && (
            <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5 self-center">
              <RefreshCw className="h-3.5 w-3.5" />
              重新获取二维码
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
