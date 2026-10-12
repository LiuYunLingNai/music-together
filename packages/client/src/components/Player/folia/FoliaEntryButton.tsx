import { useState } from 'react'
import { Leaf, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import type { StageMode } from '../mineradio/VisualModeMenu'
import { isFoliaModeId } from './registry'
import { FoliaSettingsPopover } from './FoliaSettingsPopover'

export function FoliaEntryButton({ mode, onSelect }: { mode: StageMode; onSelect: (mode: StageMode) => void }) {
  const [open, setOpen] = useState(false)
  const savedMode = useSettingsStore((s) => s.foliaSettings.lyricMode)
  const active = isFoliaModeId(mode)
  return (
    <FoliaSettingsPopover
      open={open}
      onOpenChange={(next) => {
        if (active) setOpen(next)
      }}
    >
      <Button
        type="button"
        variant={active ? 'secondary' : 'ghost'}
        className="h-11 gap-2 rounded-full px-3 text-primary"
        aria-label={active ? 'Folia 播放器设置' : '进入 Folia 播放器'}
        onClick={() => {
          if (active) setOpen(true)
          else onSelect(savedMode)
        }}
      >
        <Leaf className="size-4" />
        <span>Folia</span>
        {active && <Settings2 className="size-3.5 opacity-60" />}
      </Button>
    </FoliaSettingsPopover>
  )
}
