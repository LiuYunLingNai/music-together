import { Clock3, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** Compact lyric timing control placed next to the room search action. */
export function LyricCalibration() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const lyricOffsetPreview = usePlayerStore((s) => s.lyricOffsetPreview)
  const setLyricOffsetPreview = usePlayerStore((s) => s.setLyricOffsetPreview)
  const lyricOffsets = useSettingsStore((s) => s.lyricOffsets)
  const setLyricOffset = useSettingsStore((s) => s.setLyricOffset)
  const clearLyricOffset = useSettingsStore((s) => s.clearLyricOffset)
  const [open, setOpen] = useState(false)

  const lyricOffsetKey = getLyricOffsetKey(currentTrack)
  const savedLyricOffsetMs = lyricOffsets[lyricOffsetKey ?? ''] ?? 0
  const lyricOffsetMs = lyricOffsetPreview?.key === lyricOffsetKey ? lyricOffsetPreview.offsetMs : savedLyricOffsetMs
  const lyricOffsetLabel =
    lyricOffsetMs === 0
      ? '未校正'
      : `歌词${lyricOffsetMs > 0 ? '延后' : '提前'} ${Math.abs(lyricOffsetMs / 1000).toFixed(1)} 秒`

  useEffect(() => {
    setLyricOffsetPreview(null)
  }, [lyricOffsetKey, setLyricOffsetPreview])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setLyricOffsetPreview(null)
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              disabled={!lyricOffsetKey}
              aria-label="歌词校正"
            >
              <Clock3 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>歌词校正</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" side="bottom" className="w-72 border-white/10 bg-background/95 p-3 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-primary/90">歌词校正</span>
          <div className="flex items-center gap-1">
            <span className="text-primary/65">{lyricOffsetLabel}</span>
            {lyricOffsetMs !== 0 && lyricOffsetKey && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-primary/75 hover:bg-primary/10 hover:text-primary"
                onClick={() => {
                  setLyricOffsetPreview(null)
                  clearLyricOffset(lyricOffsetKey)
                }}
                aria-label="重置歌词校正"
              >
                <RotateCcw />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-muted-foreground">-10s</span>
          <Slider
            value={[lyricOffsetMs / 1000]}
            min={-10}
            max={10}
            step={0.1}
            onValueChange={([value]) => {
              if (lyricOffsetKey) setLyricOffsetPreview({ key: lyricOffsetKey, offsetMs: value * 1000 })
            }}
            onValueCommit={([value]) => {
              if (lyricOffsetKey) setLyricOffset(lyricOffsetKey, value * 1000)
              setLyricOffsetPreview(null)
            }}
          />
          <span className="text-[10px] tabular-nums text-muted-foreground">+10s</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
