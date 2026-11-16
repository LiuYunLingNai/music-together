import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Info, RotateCcw } from 'lucide-react'
import { SettingBadgePill, type SettingBadge } from './SettingsSection'

export function SettingRow({
  label,
  description,
  details,
  badge,
  onReset,
  children,
}: {
  label: string
  description?: string
  /** 长说明：行内只留一句，细节收进问号提示里 */
  details?: string
  badge?: SettingBadge
  /** 传入时显示重置按钮，点击触发回调 */
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Label className="text-sm font-medium">{label}</Label>
          {badge && <SettingBadgePill badge={badge} />}
          {details && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${label}的详细说明`}
                  className="text-muted-foreground/70 hover:text-foreground"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 text-xs leading-relaxed">{details}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onReset && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onReset}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>恢复默认</TooltipContent>
          </Tooltip>
        )}
        {children}
      </div>
    </div>
  )
}
