import { useEffect, useState } from 'react'
import { AudioLines, Boxes, Leaf } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSettingsStore } from '@/stores/settingsStore'
import { VISUAL_MODES } from './VisualMode'
import { resolveStageFamily, type StageMode, type StageFamily } from './registry'
import { FOLIA_MODES, isFoliaModeId, type FoliaModeId } from '../folia/registry'
import { FoliaSettingsPopover } from '../folia/FoliaSettingsPopover'
import { cn } from '@/lib/utils'
import { Check, Settings2 } from 'lucide-react'

/**
 * 舞台切换器 —— 三段胶囊（经典 | 3D 视觉 | Folia）。
 *
 * 替代原先的两个并列入口（FoliaEntryButton + VisualModeMenu）。旧结构的问题：
 * Folia 的 14 个歌词样式藏在设置浮层里，用户没有一处能"纵览全部舞台"；
 * 且 Folia 按钮的点击语义随状态漂移（进入 ↔ 设置）。
 *
 * 交互约定：
 * - 点**未激活**的段 → 切到该族"上次使用"的模式（3D 族用会话内记忆，
 *   Folia 族用持久化的 `foliaSettings.lyricMode`；classic 段无记忆需求）。
 * - 点**已激活**的段 → 弹出该族的模式列表（classic 段是回退项，无列表，
 *   点击无动作）。
 * - Folia 浮层底部附"播放器设置"入口（复用 FoliaSettingsPopover）。
 *
 * ★ 段高亮与渲染分支同源：`mode` 由 AudioPlayer 从 `useVisualStageSupport`
 *   的推导值传下来，不会与实际渲染的舞台分叉（见 AudioPlayer 内注释）。
 */

/** 会话内记忆的 3D 模式 —— 没有持久化字段（`visualStage` 会被切换覆写），刻意保持轻量。 */
let lastMineradioMode: StageMode = 'emily'

interface StageSwitcherProps {
  mode: StageMode
  onSelect: (mode: StageMode) => void
}

const SEGMENTS: ReadonlyArray<{ family: StageFamily | 'classic'; label: string; icon: typeof Leaf }> = [
  { family: 'classic', label: '经典', icon: AudioLines },
  { family: 'mineradio', label: '3D', icon: Boxes },
  { family: 'folia', label: 'Folia', icon: Leaf },
]

export function StageSwitcher({ mode, onSelect }: StageSwitcherProps) {
  const savedFoliaMode = useSettingsStore((s) => s.foliaSettings.lyricMode)
  const [flyoutOpen, setFlyoutOpen] = useState<StageFamily | null>(null)
  const activeFamily = resolveStageFamily(mode) ?? 'classic'
  /**
   * 浮层的"实际开合"在渲染期派生：只有"用户在该族上打开"且"该族仍是当前
   * 舞台"时才算开。这样从 Folia 切到经典（或浮层里选了另一个族的模式）时
   * 浮层随舞台切换即时消失，不需要在 effect 里追赶 setState
   * （react-hooks/set-state-in-effect 红线）。
   */
  const openFlyout = flyoutOpen === activeFamily ? flyoutOpen : null

  // 记录最近一次使用的 3D 模式：只在当前真的是 3D 模式时写入，
  // 否则从 Folia/classic 切回 3D 时会拿到错误的记忆。
  useEffect(() => {
    if (activeFamily === 'mineradio') lastMineradioMode = mode
  }, [activeFamily, mode])

  const handleSegmentClick = (family: StageFamily | 'classic') => {
    if (family === activeFamily) {
      // 已激活：classic 无模式列表；两族展开各自的选择浮层。
      if (family !== 'classic') setFlyoutOpen((open) => (open === family ? null : family))
      return
    }
    setFlyoutOpen(null)
    onSelect(family === 'classic' ? 'classic' : family === 'mineradio' ? lastMineradioMode : savedFoliaMode)
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="切换播放器舞台">
      <div className="flex items-center rounded-full border border-white/10 bg-black/40 p-1 shadow-lg backdrop-blur-md">
        {SEGMENTS.map(({ family, label, icon: Icon }) => {
          const active = family === activeFamily
          const content = (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={active}
              aria-label={`切换到${family === 'classic' ? '经典播放器' : family === 'mineradio' ? '3D 视觉' : 'Folia 歌词'}${active ? '（当前）' : ''}`}
              className={cn(
                'h-8 gap-1.5 rounded-full px-3 text-xs text-primary/75 hover:text-primary',
                active && 'bg-primary/15 text-primary',
              )}
              onClick={() => handleSegmentClick(family)}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
            </Button>
          )
          return family === 'folia' ? (
            <Popover
              key={family}
              open={openFlyout === 'folia'}
              onOpenChange={(open) => setFlyoutOpen(open ? 'folia' : null)}
            >
              <PopoverTrigger asChild>{content}</PopoverTrigger>
              <FoliaModeFlyout onSelect={onSelect} onSettingsOpen={() => setFlyoutOpen(null)} />
            </Popover>
          ) : family === 'mineradio' ? (
            <Popover
              key={family}
              open={openFlyout === 'mineradio'}
              onOpenChange={(open) => setFlyoutOpen(open ? 'mineradio' : null)}
            >
              <PopoverTrigger asChild>{content}</PopoverTrigger>
              <MineradioModeFlyout onSelect={onSelect} />
            </Popover>
          ) : (
            <span key={family}>{content}</span>
          )
        })}
      </div>
    </div>
  )
}

/** 3D 族的模式列表浮层。选模式走 `onSelect`（AudioPlayer 的适配器），与段点击同源。 */
function MineradioModeFlyout({ onSelect }: { onSelect: (mode: StageMode) => void }) {
  const mode = useSettingsStore((s) => s.visualStage)
  return (
    <PopoverContent align="end" sideOffset={8} className="w-56 rounded-2xl border-white/10 bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
      <p className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">3D 视觉（重 GPU）</p>
      {VISUAL_MODES.map((item) => (
        <FlyoutItem key={item.id} label={item.label} active={mode === item.id} onSelect={() => onSelect(item.id)} />
      ))}
    </PopoverContent>
  )
}

/** Folia 族的 14 模式网格浮层，底部附设置入口。选模式走 `onSelect`（同源适配器）。 */
function FoliaModeFlyout({
  onSelect,
  onSettingsOpen,
}: {
  onSelect: (mode: StageMode) => void
  onSettingsOpen: () => void
}) {
  const stage = useSettingsStore((s) => s.visualStage)
  const settings = useSettingsStore((s) => s.foliaSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 高亮跟随持久化值（与 FoliaSettingsPanel 同源）：即便当前在别的舞台，
  // 浮层里也应显示"Folia 将进入哪个模式"。
  const mode = isFoliaModeId(stage) ? stage : settings.lyricMode
  const description = FOLIA_MODES.find((item) => item.id === mode)?.description

  const selectMode = (next: FoliaModeId) => {
    onSelect(next)
    onSettingsOpen()
  }

  return (
    <PopoverContent align="end" sideOffset={8} className="w-[min(300px,calc(100vw-24px))] rounded-2xl border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl">
      <p className="pb-2 text-xs font-semibold text-muted-foreground">Folia 歌词样式</p>
      <div className="grid grid-cols-4 gap-1.5" aria-label="Folia 歌词样式">
        {FOLIA_MODES.map((item) => (
          <Button
            key={item.id}
            variant={mode === item.id ? 'secondary' : 'outline'}
            aria-pressed={mode === item.id}
            title={item.description}
            className="h-9 rounded-full px-1 text-xs"
            onClick={() => selectMode(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {description && <p className="pt-2 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-2 border-t pt-2">
        <FoliaSettingsPopover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 text-xs"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-3.5" />
            播放器设置
          </Button>
        </FoliaSettingsPopover>
      </div>
    </PopoverContent>
  )
}

/** 浮层内的单项：文案 + 当前项勾选。 */
function FlyoutItem({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 w-full justify-between rounded-xl px-3 text-xs font-normal"
      onClick={onSelect}
    >
      <span>{label}</span>
      {active && <Check className="size-4 opacity-70" />}
    </Button>
  )
}
