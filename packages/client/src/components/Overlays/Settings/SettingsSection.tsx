import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type SettingBadge = 'room' | 'local' | 'experimental'

const BADGE_STYLES: Record<SettingBadge, { label: string; className: string }> = {
  room: { label: '房间', className: 'border-sky-500/40 text-sky-600 dark:text-sky-400' },
  local: { label: '本机', className: 'border-border text-muted-foreground' },
  experimental: { label: '实验', className: 'border-amber-500/40 text-amber-600 dark:text-amber-400' },
}

export function SettingBadgePill({ badge, className }: { badge: SettingBadge; className?: string }) {
  const style = BADGE_STYLES[badge]
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  )
}

/**
 * 设置页的一节：标题、一句话说明、可选的归属徽章。
 * 归属写在节标题上，用户先知道“这项归谁管”，再看具体开关。
 */
export function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string
  description?: string
  badge?: SettingBadge
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {badge && <SettingBadgePill badge={badge} />}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Separator className="mt-2" />
      </div>
      {children}
    </section>
  )
}
