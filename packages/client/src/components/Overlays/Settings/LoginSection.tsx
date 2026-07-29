import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getVipDisplayLabel } from '@/lib/platform'
import type { MusicSource, MyPlatformAuth, PlatformAuthStatus } from '@music-together/shared'
import { Crown, Gift, KeyRound, Loader2, LogOut, ScanLine } from 'lucide-react'

interface LoginSectionProps {
  platform: MusicSource
  status?: PlatformAuthStatus
  myStatus?: MyPlatformAuth
  /** localStorage has a cookie for this platform but server hasn't confirmed yet */
  isVerifying?: boolean
  onQrLogin: () => void
  onCookieLogin: () => void
  onLogout: () => void
  compactLabel?: string
  onClaimConceptVip?: () => void
  isClaimingConceptVip?: boolean
}

export function LoginSection({
  platform,
  status,
  myStatus,
  isVerifying,
  onQrLogin,
  onCookieLogin,
  onLogout,
  compactLabel,
  onClaimConceptVip,
  isClaimingConceptVip,
}: LoginSectionProps) {
  const loggedInCount = status?.loggedInCount ?? 0
  const hasVip = status?.hasVip ?? false
  const maxVipType = status?.maxVipType ?? 0
  const isMyLoggedIn = myStatus?.loggedIn ?? false
  const displayedVipType = isMyLoggedIn ? (myStatus?.vipType ?? 0) : maxVipType
  const displayedVipLabel = getVipDisplayLabel(
    displayedVipType,
    isMyLoggedIn ? myStatus?.vipLabel : status?.maxVipLabel,
  )

  return (
    <div className="flex items-center justify-between gap-2 overflow-hidden rounded-lg border p-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {compactLabel && <span className="text-muted-foreground shrink-0 text-xs">{compactLabel}</span>}
          {isMyLoggedIn && myStatus?.nickname ? (
            <span className="truncate text-sm font-medium">{myStatus.nickname}</span>
          ) : isVerifying ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-sm">
              <Loader2 className="h-3 w-3 animate-spin" />
              验证登录中…
            </span>
          ) : (
            <span className="text-muted-foreground shrink-0 text-sm">未登录</span>
          )}
          {displayedVipType > 0 && (
            <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
              <Crown className="h-3 w-3" />
              {displayedVipLabel}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {loggedInCount > 0 ? `房间内 ${loggedInCount} 人已登录${hasVip ? '，VIP 可用' : ''}` : '房间暂无人登录此平台'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!isMyLoggedIn && !isVerifying ? (
          <>
            {(platform === 'netease' ||
              platform === 'kugou' ||
              platform === 'kugou_concept' ||
              platform === 'tencent' ||
              platform === 'bilibili') && (
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={onQrLogin} title="扫码登录">
                <ScanLine className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={onCookieLogin} title="Cookie 登录">
              <KeyRound className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : isMyLoggedIn ? (
          <>
            {platform === 'kugou_concept' && onClaimConceptVip && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                onClick={onClaimConceptVip}
                disabled={isClaimingConceptVip}
                title="手动领取酷狗官方每日概念版权益"
              >
                {isClaimingConceptVip ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Gift className="h-3.5 w-3.5" />
                )}
                领权益
              </Button>
            )}
            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={onLogout} title="登出">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
