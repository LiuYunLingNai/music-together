import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Check, Sparkles } from 'lucide-react'
import { VISUAL_MODES, type VisualModeId } from './shared/VisualMode'

export type StageMode = 'classic' | VisualModeId

interface VisualModeMenuProps {
  mode: StageMode
  onSelect: (mode: StageMode) => void
  className?: string
}

/**
 * 播放器 / 视觉模式菜单。
 *
 * 经典播放器始终作为第一项且无损可回退。
 */
export function VisualModeMenu({ mode, onSelect, className }: VisualModeMenuProps) {
  const isClassic = mode === 'classic'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 text-primary/80 hover:bg-primary/10 hover:text-primary',
                !isClassic && 'text-primary',
                className,
              )}
              aria-label="切换播放器视觉模式"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>播放器视觉模式</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>播放器</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onSelect('classic')}>
          <span className="flex-1">经典播放器</span>
          {isClassic && <Check className="h-4 w-4 opacity-70" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>视觉模式</DropdownMenuLabel>
        {VISUAL_MODES.map((item) => {
          const active = mode === item.id
          return (
            <DropdownMenuItem key={item.id} onSelect={() => onSelect(item.id)}>
              <span className="flex-1">{item.label}</span>
              {active && <Check className="h-4 w-4 opacity-70" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
