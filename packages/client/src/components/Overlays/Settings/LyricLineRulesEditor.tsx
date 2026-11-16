import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  createLyricLineRule,
  LYRIC_LINE_PRESETS,
  type LyricLineRule,
  type LyricLineRuleShape,
} from '@/lib/lyrics/lyricLineRules'
import { useSettingsStore } from '@/stores/settingsStore'

const SHAPE_LABELS: Record<Exclude<LyricLineRuleShape, 'preset'>, string> = {
  contains: '包含',
  starts: '开头',
  whole: '整行',
  ends: '结尾',
  written: '正则',
}

const PRESET_LABELS: Record<string, string> = Object.fromEntries(
  LYRIC_LINE_PRESETS.map((preset) => [preset.id, preset.label]),
)

export function LyricLineRulesEditor() {
  const rules = useSettingsStore((state) => state.lyricLineRules)
  const setRules = useSettingsStore((state) => state.setLyricLineRules)

  const updateRule = (id: string, patch: Partial<LyricLineRule>) => {
    setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const addRule = () => setRules([...rules, createLyricLineRule()])

  const addPreset = (presetId: string) => {
    if (rules.some((rule) => rule.shape === 'preset' && rule.text === presetId)) return
    const rule = createLyricLineRule('preset')
    setRules([...rules, { ...rule, text: presetId }])
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">命中的歌词行会在所有播放器中隐藏，不重新请求歌词。</p>

      <div className="flex flex-wrap gap-2">
        {LYRIC_LINE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            disabled={rules.some((rule) => rule.shape === 'preset' && rule.text === preset.id)}
            onClick={() => addPreset(preset.id)}
          >
            + {preset.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={addRule}>
          + 自定义规则
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">尚未添加过滤规则。</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={(enabled) => updateRule(rule.id, { enabled })}
                aria-label="启用过滤规则"
              />
              {rule.shape === 'preset' ? (
                <span className="flex-1 text-sm">{PRESET_LABELS[rule.text] ?? rule.text}</span>
              ) : (
                <>
                  <Select
                    value={rule.shape}
                    onValueChange={(shape) => updateRule(rule.id, { shape: shape as LyricLineRuleShape })}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SHAPE_LABELS) as Array<keyof typeof SHAPE_LABELS>).map((shape) => (
                        <SelectItem key={shape} value={shape}>
                          {SHAPE_LABELS[shape]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={rule.text}
                    onChange={(event) => updateRule(rule.id, { text: event.target.value })}
                    placeholder={rule.shape === 'written' ? '正则表达式，如 ^作词\\s*[:：]' : '要过滤的文字'}
                    className="min-w-40 flex-1 text-xs"
                  />
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))}>
                删除
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
