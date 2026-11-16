import { Badge } from '@/components/ui/badge'
import { getVipDisplayLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { Crown } from 'lucide-react'

interface VipBadgeProps {
  vipType: number | undefined
  /** 平台返回的会员名称（优先于按等级推断的名称）。 */
  label?: string
  className?: string
}

/** 音乐账号的会员徽章；无会员时不渲染。 */
export function VipBadge({ vipType, label, className }: VipBadgeProps) {
  if (!vipType || vipType <= 0) return null
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 gap-1 border-amber-500/30 bg-amber-500/15 text-xs text-amber-600 dark:text-amber-400', className)}
    >
      <Crown aria-hidden className="size-3" />
      {getVipDisplayLabel(vipType, label)}
    </Badge>
  )
}
