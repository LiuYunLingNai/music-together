import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveBeatEffectSetting } from '@/services/beatFx/beatEffects'
import type { SmartBeatMode } from '@/services/beatFx/beatFxTypes'
import { FOLIA_MODE_BEAT_EFFECTS } from '@/services/beatFx/beatClockTargets'
import { isFoliaModeId } from './registry'

/**
 * 智能动感模式 —— 上游 `SmartBeatSettingsCard.tsx` + `BeatEffectsGroup.tsx` 的宿主版本。
 *
 * 上与上游同一语义：
 *   · 全局一档：关闭 / 只用已分析 / 开启；开与关决定画面是不是拍点帧。
 *   · 每个效果自己的开关与强度（0..2，1 是调好的样子），只列当前样式声明过的。
 * 差异：上游的拍点来自 beat_this 模型，本仓来自离线拍点分析，因此「只用已分析」
 * 与「开启」在当前实现里等价 —— 分析本来就不落盘缓存。文案里如实说明。
 */
const MODE_OPTIONS: ReadonlyArray<{ value: SmartBeatMode; label: string; note: string }> = [
  { value: 'off', label: '关闭', note: '画面完全按原来的音频响应走。' },
  { value: 'cached', label: '只用已分析', note: '不新开分析；有拍点表时按拍点画。' },
  { value: 'on', label: '开启', note: '切歌后在后台分析整首歌，拍点到达即生效。' },
]

export function SmartBeatSettings({ mode }: { mode: string }) {
  const smartBeat = useSettingsStore((s) => s.smartBeat)
  const setSmartBeat = useSettingsStore((s) => s.setSmartBeat)
  const effects = isFoliaModeId(mode) ? (FOLIA_MODE_BEAT_EFFECTS[mode] ?? []) : []
  const active = smartBeat.mode !== 'off'
  const selected = MODE_OPTIONS.find((option) => option.value === smartBeat.mode) ?? MODE_OPTIONS[0]
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-xs font-medium">智能动感</summary>
      <div className="mt-4 space-y-4">
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span>模式</span>
            <Select value={smartBeat.mode} onValueChange={(next) => setSmartBeat({ mode: next as SmartBeatMode })}>
              <SelectTrigger aria-label="智能动感模式" className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-muted-foreground">{selected.note}</p>
        </div>
        {effects.length === 0 && (
          <p className="text-xs text-muted-foreground">这个样式没有随拍效果。</p>
        )}
        {effects.map((effect) => {
          const setting = resolveBeatEffectSetting(smartBeat, effect.id)
          return (
            <div key={effect.id} className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span>{effect.nameKey}</span>
                <Switch
                  aria-label={effect.nameKey}
                  checked={setting.on}
                  disabled={!active}
                  onCheckedChange={(on) => setSmartBeat({ effects: { [effect.id]: { on } } })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  aria-label={`${effect.nameKey}强度`}
                  value={[setting.strength]}
                  min={0}
                  max={2}
                  step={0.05}
                  disabled={!active || !setting.on}
                  onValueChange={([strength]) =>
                    setSmartBeat({ effects: { [effect.id]: { on: setting.on, strength } } })
                  }
                />
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {setting.strength.toFixed(2)}
                </span>
              </div>
            </div>
          )
        })}
        {active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSmartBeat({ effects: Object.fromEntries(effects.map((effect) => [effect.id, { on: true, strength: 1 }])) })
            }
          >
            重置效果强度
          </Button>
        )}
      </div>
    </details>
  )
}
