import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveBeatEffectPartStrength, resolveBeatEffectSetting } from '@/services/beatFx/beatEffects'
import type { SmartBeatMode } from '@/services/beatFx/beatFxTypes'
import { FOLIA_MODE_BEAT_EFFECTS } from '@/services/beatFx/beatClockTargets'
import { t } from './upstream/adapters/i18n'
import { isFoliaModeId } from './registry'

/**
 * 智能动感模式 —— 上游 `SmartBeatSettingsCard.tsx` + `BeatEffectsGroup.tsx` 的宿主版本。
 *
 * 上与上游同一语义：
 *   · 全局一档：关闭 / 只用已分析 / 开启；开与关决定画面是不是拍点帧。
 *   · 每个效果自己的开关与强度（0..2，1 是调好的样子），只列当前样式声明过的。
 * 差异：上游的拍点来自 beat_this 模型，本仓来自离线拍点分析；分析结果会落盘缓存，
 * 但两种「开」的模式目前都允许新开分析（缓存命中时不重复跑）。
 */

const MODE_OPTIONS: ReadonlyArray<{ value: SmartBeatMode; label: string; note: string }> = [
  { value: 'off', label: '关闭', note: '画面完全按原来的音频响应走。' },
  { value: 'cached', label: '只用已分析', note: '优先用缓存的拍点表；没有缓存时同样会分析一次。' },
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
          const rows = effect.parts?.length
            ? effect.parts.map((part) => ({
                key: `${effect.id}.${part.key}`,
                label: t(part.nameKey),
                value: resolveBeatEffectPartStrength(setting, part.key),
                patched: (strength: number) => ({ effects: { [effect.id]: { parts: { [part.key]: strength } } } }),
              }))
            : [{
                key: effect.id,
                label: t('options.beatEffectStrength'),
                value: setting.strength,
                patched: (strength: number) => ({ effects: { [effect.id]: { on: setting.on, strength } } }),
              }]
          return (
            <div key={effect.id} className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span>{t(effect.nameKey)}</span>
                <Switch
                  aria-label={t(effect.nameKey)}
                  checked={setting.on}
                  disabled={!active}
                  onCheckedChange={(on) => setSmartBeat({ effects: { [effect.id]: { on } } })}
                />
              </div>
              {rows.map((row) => (
                <div key={row.key} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-muted-foreground">{row.label}</span>
                  <Slider
                    aria-label={row.label}
                    value={[row.value]}
                    min={0}
                    max={2}
                    step={0.05}
                    disabled={!active || !setting.on}
                    onValueChange={([strength]) => setSmartBeat(row.patched(strength))}
                  />
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                    {row.value.toFixed(2)}
                  </span>
                </div>
              ))}
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
