import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSettingsStore } from '@/stores/settingsStore'
import { FOLIA_MODE_CONTROLS } from '@/lib/foliaTuningSchema'
import { resolveFoliaTuning } from './stage/foliaTunings'
import type { FoliaModeId } from './registry'

export function FoliaModeSettings({ mode }: { mode: FoliaModeId }) {
  const tunings = useSettingsStore((s) => s.foliaSettings.tunings)
  const update = useSettingsStore((s) => s.setFoliaSettings)
  const tuning = resolveFoliaTuning(mode, tunings)
  const controls = FOLIA_MODE_CONTROLS[mode].filter((control) => control.key in tuning)
  if (!controls.length) return null
  const set = (key: string, value: unknown) =>
    update({ tunings: { ...tunings, [mode]: { ...tunings[mode], [key]: value } } })
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-xs font-medium">动画参数</summary>
      <div className="mt-4 space-y-4">
        {controls.map((control) => (
          <div key={control.key} className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span>{control.label}</span>
              {typeof tuning[control.key] === 'boolean' ? (
                <Switch
                  aria-label={control.label}
                  checked={Boolean(tuning[control.key])}
                  onCheckedChange={(value) => set(control.key, value)}
                />
              ) : control.options ? (
                <Select value={String(tuning[control.key])} onValueChange={(value) => set(control.key, value)}>
                  <SelectTrigger aria-label={control.label} className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {control.options.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="tabular-nums text-muted-foreground">{Number(tuning[control.key]).toFixed(2)}</span>
              )}
            </div>
            {typeof tuning[control.key] === 'number' && (
              <Slider
                aria-label={control.label}
                value={[Number(tuning[control.key])]}
                min={control.min}
                max={control.max}
                step={control.step}
                onValueChange={([value]) => set(control.key, value)}
              />
            )}
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => update({ tunings: { ...tunings, [mode]: {} } })}>
          重置此动画
        </Button>
      </div>
    </details>
  )
}
