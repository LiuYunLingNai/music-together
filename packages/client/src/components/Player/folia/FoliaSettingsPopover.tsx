import { useId, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { FOLIA_BACKGROUNDS } from '@/lib/foliaSettings'
import { FOLIA_MODES, isFoliaModeId } from './registry'
import { FoliaBackgroundSettings } from './FoliaBackgroundSettings'
import { FoliaModeSettings } from './FoliaModeSettings'

export function FoliaSettingsPopover({
  open,
  onOpenChange,
  children,
  side = 'bottom',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  const titleId = useId()
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={12}
        collisionPadding={12}
        aria-labelledby={titleId}
        className="folia-settings-panel w-[min(360px,calc(100vw-24px))] rounded-2xl border-white/10 bg-background/95 p-0 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 id={titleId} className="text-sm font-semibold">
            Folia 播放器设置
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="关闭 Folia 设置"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <FoliaSettingsPanel onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  )
}

function FoliaSettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'style' | 'background' | 'player'>('style')
  const settings = useSettingsStore((s) => s.foliaSettings)
  const stage = useSettingsStore((s) => s.visualStage)
  const setSettings = useSettingsStore((s) => s.setFoliaSettings)
  const setStage = useSettingsStore((s) => s.setVisualStage)
  const reset = useSettingsStore((s) => s.resetFoliaSettings)
  const mode = isFoliaModeId(stage) ? stage : settings.lyricMode
  const tabs = [
    ['style', '样式'],
    ['background', '背景'],
    ['player', '播放器'],
  ] as const
  return (
    <>
      <div className="grid grid-cols-3 gap-1 p-2" role="tablist" aria-label="Folia 设置分类">
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'secondary' : 'ghost'}
            className="h-10 rounded-xl"
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="max-h-[min(420px,calc(100dvh-200px))] space-y-4 overflow-y-auto overscroll-contain px-4 pb-4"
      >
        {tab === 'style' && (
          <>
            <div className="grid grid-cols-4 gap-2" aria-label="Folia 歌词样式">
              {FOLIA_MODES.map((item) => (
                <Button
                  key={item.id}
                  variant={mode === item.id ? 'secondary' : 'outline'}
                  aria-pressed={mode === item.id}
                  title={item.description}
                  className="h-11 rounded-full px-1 text-xs"
                  onClick={() => {
                    setSettings({ lyricMode: item.id })
                    if (isFoliaModeId(stage)) setStage(item.id)
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{FOLIA_MODES.find((item) => item.id === mode)?.description}</p>
            <Range
              label="歌词大小"
              value={settings.fontScale * 100}
              min={60}
              max={180}
              step={5}
              suffix="%"
              onChange={(value) => setSettings({ fontScale: value / 100 })}
            />
            <Range
              label="字幕大小"
              value={settings.subtitleScale * 100}
              min={60}
              max={180}
              step={5}
              suffix="%"
              onChange={(value) => setSettings({ subtitleScale: value / 100 })}
            />
            <Toggle
              label="显示翻译"
              checked={settings.showTranslation}
              onChange={(showTranslation) => setSettings({ showTranslation })}
            />
            <Toggle
              label="显示音译"
              checked={settings.showRomanization}
              onChange={(showRomanization) => setSettings({ showRomanization })}
            />
            <FoliaModeSettings mode={mode} />
          </>
        )}
        {tab === 'background' && (
          <>
            <div className="grid grid-cols-2 gap-2" aria-label="Folia 背景">
              {FOLIA_BACKGROUNDS.map((item) => (
                <Button
                  key={item.id}
                  variant={settings.background === item.id ? 'secondary' : 'outline'}
                  aria-pressed={settings.background === item.id}
                  className="h-11 rounded-xl px-2 text-xs"
                  onClick={() => setSettings({ background: item.id })}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Range
              label="背景压暗"
              value={settings.backgroundDim * 100}
              min={0}
              max={85}
              step={5}
              suffix="%"
              onChange={(value) => setSettings({ backgroundDim: value / 100 })}
            />
            <Toggle
              label="背景动画"
              checked={settings.backgroundMotion}
              onChange={(backgroundMotion) => setSettings({ backgroundMotion })}
            />
            <FoliaBackgroundSettings />
          </>
        )}
        {tab === 'player' && (
          <>
            <Toggle
              label="显示进度条"
              checked={settings.showProgress}
              onChange={(showProgress) => setSettings({ showProgress })}
            />
            <Toggle
              label="始终展开播放栏"
              checked={settings.alwaysExpand}
              onChange={(alwaysExpand) => setSettings({ alwaysExpand })}
            />
            <Toggle
              label="自动隐藏播放栏"
              checked={settings.autoHide}
              onChange={(autoHide) => setSettings({ autoHide })}
            />
            <p className="text-xs text-muted-foreground">闲置 3 秒后淡出，鼠标或键盘操作恢复；聚焦控件时保持可见。</p>
            <Range
              label="播放栏离底距离"
              value={settings.barOffset}
              min={16}
              max={160}
              step={4}
              suffix="px"
              onChange={(barOffset) => setSettings({ barOffset })}
            />
          </>
        )}
      </div>
      <div className="flex justify-between border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset()
            if (isFoliaModeId(stage)) setStage('luminous')
          }}
        >
          恢复默认
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>
          完成
        </Button>
      </div>
    </>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
function Range({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <Slider
        aria-label={`Folia ${label}`}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  )
}
