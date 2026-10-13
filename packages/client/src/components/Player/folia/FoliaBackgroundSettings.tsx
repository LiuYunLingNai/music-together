import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  DEFAULT_LATENT_BACKGROUND_TUNING,
  DEFAULT_MONET_BACKGROUND_TUNING,
  DEFAULT_NOMAND_BACKGROUND_TUNING,
} from './types'
import { normalizeUrlBackgroundUrl } from './upstream/utils/urlBackground'
import type { VisualizerBackgroundConfig } from './upstream/components/visualizer/backgrounds/definition'
import { useState } from 'react'

const NOMAND_EFFECTS = [
  ['dithering', '图像抖色'],
  ['fluted-glass', '磨砂玻璃'],
  ['paper-texture', '纸张纹理'],
  ['halftone-dots', '半色调网点'],
  ['lens-distortion', '镜头畸变'],
] as const

export function FoliaBackgroundSettings() {
  const settings = useSettingsStore((s) => s.foliaSettings)
  const update = useSettingsStore((s) => s.setFoliaSettings)
  const config = settings.backgroundConfig
  const [urlDraft, setUrlDraft] = useState('')
  const [urlError, setUrlError] = useState('')
  const save = (patch: Partial<VisualizerBackgroundConfig>) => update({ backgroundConfig: { ...config, ...patch } })
  const latent = { ...DEFAULT_LATENT_BACKGROUND_TUNING, ...config.latent?.tuning }
  const monet = { ...DEFAULT_MONET_BACKGROUND_TUNING, ...config.monet?.tuning }
  const nomand = { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...config.nomand?.tuning }
  const row = 'flex min-h-10 items-center justify-between gap-3 text-xs'
  return (
    <div className="space-y-4">
      {settings.background === 'common' && (
        <>
          <div className={row}>
            <span>叠加封面色彩</span>
            <Switch
              aria-label="叠加封面色彩"
              checked={!!config.common?.useCoverColorBg}
              onCheckedChange={(useCoverColorBg) => save({ common: { ...config.common, useCoverColorBg } })}
            />
          </div>
          <div className={row}>
            <span>几何图形</span>
            <Switch
              aria-label="几何图形"
              checked={!config.common?.disableGeometricBackground}
              onCheckedChange={(enabled) =>
                save({ common: { ...config.common, disableGeometricBackground: !enabled } })
              }
            />
          </div>
          <div className={row}>
            <span>暗角</span>
            <Switch
              aria-label="通用背景暗角"
              checked={!config.common?.disableVignette}
              onCheckedChange={(enabled) => save({ common: { ...config.common, disableVignette: !enabled } })}
            />
          </div>
          {config.common?.useCoverColorBg && (
            <NumberSetting
              label="封面叠层透明度"
              value={config.common.opacity ?? 0.75}
              min={0}
              max={1}
              onChange={(opacity) => save({ common: { ...config.common, opacity } })}
            />
          )}
        </>
      )}
      {settings.background === 'latent' && (
        <>
          <Choice
            label="隐现图层"
            value={latent.displayMode}
            values={['dithering', 'mesh', 'both']}
            onChange={(displayMode) =>
              save({ latent: { tuning: { ...latent, displayMode: displayMode as typeof latent.displayMode } } })
            }
          />
          <Choice
            label="取色来源"
            value={latent.colorSource}
            values={['cover-theme', 'cover-only']}
            onChange={(colorSource) =>
              save({ latent: { tuning: { ...latent, colorSource: colorSource as typeof latent.colorSource } } })
            }
          />
          <NumberSetting
            label="网格速度"
            value={latent.meshSpeed}
            min={0}
            max={2}
            onChange={(meshSpeed) => save({ latent: { tuning: { ...latent, meshSpeed } } })}
          />
          <NumberSetting
            label="抖色速度"
            value={latent.ditheringSpeed}
            min={0}
            max={2}
            onChange={(ditheringSpeed) => save({ latent: { tuning: { ...latent, ditheringSpeed } } })}
          />
          <NumberSetting
            label="音频响应"
            value={latent.meshAudioSpeed}
            min={0}
            max={4}
            onChange={(meshAudioSpeed) =>
              save({ latent: { tuning: { ...latent, meshAudioSpeed, ditheringAudioSpeed: meshAudioSpeed } } })
            }
          />
        </>
      )}
      {settings.background === 'monet' && (
        <>
          <Choice
            label="图像布局"
            value={monet.backgroundLayout}
            values={['full-overlay', 'half-pane-gradient']}
            onChange={(backgroundLayout) =>
              save({
                monet: { tuning: { ...monet, backgroundLayout: backgroundLayout as typeof monet.backgroundLayout } },
              })
            }
          />
          <NumberSetting
            label="模糊"
            value={monet.backgroundBlurPx}
            min={0}
            max={80}
            step={1}
            onChange={(backgroundBlurPx) => save({ monet: { tuning: { ...monet, backgroundBlurPx } } })}
          />
          <NumberSetting
            label="灰度"
            value={monet.backgroundGrayscale}
            min={0}
            max={1}
            onChange={(backgroundGrayscale) => save({ monet: { tuning: { ...monet, backgroundGrayscale } } })}
          />
          <NumberSetting
            label="饱和度"
            value={monet.backgroundSaturation}
            min={0}
            max={3}
            onChange={(backgroundSaturation) => save({ monet: { tuning: { ...monet, backgroundSaturation } } })}
          />
          <div className={row}>
            <span>缓慢漂移</span>
            <Switch
              aria-label="莫奈背景漂移"
              checked={monet.backgroundDriftEnabled}
              onCheckedChange={(backgroundDriftEnabled) =>
                save({ monet: { tuning: { ...monet, backgroundDriftEnabled } } })
              }
            />
          </div>
        </>
      )}
      {settings.background === 'nomand' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {NOMAND_EFFECTS.map(([effect, label]) => (
              <Button
                key={effect}
                className="h-10 text-xs"
                variant={nomand.effect === effect ? 'secondary' : 'outline'}
                onClick={() => save({ nomand: { tuning: { ...nomand, effect } } })}
              >
                {label}
              </Button>
            ))}
          </div>
          <NumberSetting
            label="抖色颗粒"
            value={nomand.size}
            min={0.5}
            max={8}
            onChange={(size) => save({ nomand: { tuning: { ...nomand, size } } })}
          />
          <NumberSetting
            label="玻璃变形"
            value={nomand.flutedGlassDistortion}
            min={0}
            max={1}
            onChange={(flutedGlassDistortion) => save({ nomand: { tuning: { ...nomand, flutedGlassDistortion } } })}
          />
          <NumberSetting
            label="镜头色散"
            value={nomand.lensDistortionDispersion}
            min={0}
            max={1}
            onChange={(lensDistortionDispersion) =>
              save({ nomand: { tuning: { ...nomand, lensDistortionDispersion } } })
            }
          />
        </>
      )}
      {(settings.background === 'monet' || settings.background === 'nomand') && (
        <>
          <Input
            aria-label="自定义背景图片地址"
            placeholder="https://… 图片地址"
            value={config.customImage?.url ?? ''}
            onChange={(event) => {
              const url = normalizeUrlBackgroundUrl(event.target.value)
              save({
                customImage: url ? { id: 'custom', name: '自定义背景', url } : null,
                ...(settings.background === 'monet'
                  ? { monet: { tuning: { ...monet, backgroundSource: url ? 'uploaded-global' : 'cover-derived' } } }
                  : { nomand: { tuning: { ...nomand, imageSource: url ? 'uploaded-global' : 'cover-derived' } } }),
              })
            }}
          />
          <p className="text-xs text-muted-foreground">留空使用当前歌曲封面。</p>
        </>
      )}
      {settings.background === 'url' && (
        <>
          <div className="flex gap-2">
            <Input
              aria-label="网页背景地址"
              placeholder="https://…"
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <Button
              size="sm"
              onClick={() => {
                const url = normalizeUrlBackgroundUrl(urlDraft)
                if (!url) {
                  setUrlError('请输入有效的 http 或 https 地址')
                  return
                }
                const item = { id: crypto.randomUUID(), url, note: new URL(url).hostname }
                save({ url: { items: [...(config.url?.items ?? []), item], selectedId: item.id } })
                setUrlDraft('')
                setUrlError('')
              }}
            >
              添加
            </Button>
          </div>
          {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          {(config.url?.items ?? []).map((item) => (
            <div key={item.id} className="flex gap-2">
              <Button
                className="min-w-0 flex-1 truncate text-xs"
                variant={config.url?.selectedId === item.id ? 'secondary' : 'outline'}
                onClick={() => save({ url: { ...config.url, selectedId: item.id } })}
              >
                {item.note}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  save({
                    url: {
                      items: config.url?.items?.filter((value) => value.id !== item.id),
                      selectedId: config.url?.selectedId === item.id ? null : config.url?.selectedId,
                    },
                  })
                }
              >
                删除
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">网页以隔离的背景层显示；部分网站禁止嵌入。</p>
        </>
      )}
      {settings.background === 'sora' && (
        <div className={row}>
          <span>纯色模式</span>
          <Switch
            aria-label="Sora 纯色模式"
            checked={!!config.sora?.tuning?.blank}
            onCheckedChange={(blank) => save({ sora: { tuning: { blank } } })}
          />
        </div>
      )}
    </div>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  )
}
function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string
  value: string
  values: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-9 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
