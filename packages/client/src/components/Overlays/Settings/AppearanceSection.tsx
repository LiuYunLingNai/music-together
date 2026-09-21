import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VISUAL_MODES } from '@/components/Player/mineradio/shared/VisualMode'
import {
  VISUAL_QUALITIES,
  VISUAL_QUALITY_LABELS,
} from '@/components/Player/mineradio/shared/RenderPolicy'
import {
  LYRIC_DISPLAY_LABELS,
  LYRIC_DISPLAY_MODES,
  LYRIC_MOTION_LABELS,
  LYRIC_MOTION_STYLES,
  LYRIC_TRANSLATION_LABELS,
  LYRIC_TRANSLATION_MODES,
} from '@/components/Player/mineradio/lyrics/lyricDisplayConfig'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'

export function AppearanceSection() {
  const s = useSettingsStore()

  return (
    <div className="space-y-6">
      {/* ---- 背景渲染 ---- */}
      <div>
        <h3 className="text-base font-semibold">背景渲染</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="帧率"
          description="更高帧率更流畅，但消耗更多性能"
          onReset={s.bgFps !== s.bgFpsDefault ? s.resetBgFps : undefined}
        >
          <Select value={String(s.bgFps)} onValueChange={(v) => s.setBgFps(parseInt(v, 10))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 FPS</SelectItem>
              <SelectItem value="30">30 FPS</SelectItem>
              <SelectItem value="60">60 FPS</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="流动速度"
          description={`当前: ${s.bgFlowSpeed.toFixed(1)}`}
          onReset={s.bgFlowSpeed !== s.bgFlowSpeedDefault ? s.resetBgFlowSpeed : undefined}
        >
          <Slider
            value={[s.bgFlowSpeed * 10]}
            min={5}
            max={50}
            step={5}
            onValueChange={(v) => s.setBgFlowSpeed(v[0] / 10)}
            className="w-32"
          />
        </SettingRow>

        <SettingRow
          label="渲染精度"
          description="更低精度更省性能"
          onReset={s.bgRenderScale !== s.bgRenderScaleDefault ? s.resetBgRenderScale : undefined}
        >
          <Select value={String(s.bgRenderScale)} onValueChange={(v) => s.setBgRenderScale(parseFloat(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.25">25%</SelectItem>
              <SelectItem value="0.5">50%</SelectItem>
              <SelectItem value="0.75">75%</SelectItem>
              <SelectItem value="1">100%</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      {/* ---- 视觉舞台 ---- */}
      <div>
        <h3 className="text-base font-semibold">视觉舞台</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="播放器模式"
          description="经典播放器始终可随时切回"
          onReset={s.visualStage !== s.visualStageDefault ? s.resetVisualStage : undefined}
        >
          <Select value={s.visualStage} onValueChange={s.setVisualStage}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="classic">经典播放器</SelectItem>
              {/* 视觉模式从 `VISUAL_MODES` 派生，避免手写列表漏项
                  （此前漏了「声波地形」，表现为菜单能选、设置面板选不到）。 */}
              {VISUAL_MODES.map((mode) => (
                <SelectItem key={mode.id} value={mode.id}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="画质"
          description="上游出厂为「节能」；想更清晰可手动调高。低端硬件会自动压低预算"
          onReset={s.visualQuality !== s.visualQualityDefault ? s.resetVisualQuality : undefined}
        >
          <Select value={s.visualQuality} onValueChange={s.setVisualQuality}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动</SelectItem>
              {VISUAL_QUALITIES.map((q) => (
                <SelectItem key={q} value={q}>
                  {VISUAL_QUALITY_LABELS[q]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="粒子溢光"
          description="封面粒子的光晕叠加（第二遍渲染）。上游出厂关闭；移动端强制关闭"
          onReset={s.visualBloom !== s.visualBloomDefault ? s.resetVisualBloom : undefined}
        >
          <Switch checked={s.visualBloom} onCheckedChange={s.setVisualBloom} />
        </SettingRow>

        <SettingRow
          label="轮廓高亮"
          description="封面粒子的边缘描亮/描暗（提升亮底可辨识度）。上游出厂关闭"
          onReset={s.visualEdge !== s.visualEdgeDefault ? s.resetVisualEdge : undefined}
        >
          <Switch checked={s.visualEdge} onCheckedChange={s.setVisualEdge} />
        </SettingRow>

        <SettingRow
          label="歌词渲染器"
          description="3D 与粒子/封面共享景深；AMLL 为可靠回退，逐字表现以 AMLL 为准"
          onReset={s.lyricRenderer !== s.lyricRendererDefault ? s.resetLyricRenderer : undefined}
        >
          <Select value={s.lyricRenderer} onValueChange={s.setLyricRenderer}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webgl">3D 场景</SelectItem>
              <SelectItem value="amll">AMLL</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {/* 以下仅对 3D 歌词生效；AMLL 模式下由 AMLL 自己的设置控制 */}
        <SettingRow
          label="歌词显示行数"
          description={
            s.lyricRenderer === 'webgl' ? '影院为 5 行，自定义可选 1-10 行' : '仅 3D 歌词渲染器生效'
          }
          onReset={
            s.lyricDisplayMode3d !== s.lyricDisplayMode3dDefault ? s.resetLyricDisplayMode3d : undefined
          }
        >
          <Select
            value={s.lyricDisplayMode3d}
            onValueChange={s.setLyricDisplayMode3d}
            disabled={s.lyricRenderer !== 'webgl'}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LYRIC_DISPLAY_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {LYRIC_DISPLAY_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        {s.lyricDisplayMode3d === 'custom' && (
          <SettingRow
            label="自定义行数"
            description={`当前: ${s.lyricCustomLineCount} 行`}
            onReset={
              s.lyricCustomLineCount !== s.lyricCustomLineCountDefault
                ? s.resetLyricCustomLineCount
                : undefined
            }
          >
            <Slider
              aria-label="3D 歌词显示行数"
              value={[s.lyricCustomLineCount]}
              min={1}
              max={10}
              step={1}
              onValueChange={([v]) => s.setLyricCustomLineCount(v)}
              className="w-32"
            />
          </SettingRow>
        )}

        <SettingRow
          label="歌词动效"
          description="故障风格会带来更强的视觉冲击"
          onReset={s.lyricMotion !== s.lyricMotionDefault ? s.resetLyricMotion : undefined}
        >
          <Select value={s.lyricMotion} onValueChange={s.setLyricMotion} disabled={s.lyricRenderer !== 'webgl'}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LYRIC_MOTION_STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  {LYRIC_MOTION_LABELS[style]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="译词显示"
          description="控制 3D 歌词中译词与音译的展示范围"
          onReset={
            s.lyricTranslationMode3d !== s.lyricTranslationMode3dDefault
              ? s.resetLyricTranslationMode3d
              : undefined
          }
        >
          <Select
            value={s.lyricTranslationMode3d}
            onValueChange={s.setLyricTranslationMode3d}
            disabled={s.lyricRenderer !== 'webgl'}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LYRIC_TRANSLATION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {LYRIC_TRANSLATION_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </div>
  )
}
