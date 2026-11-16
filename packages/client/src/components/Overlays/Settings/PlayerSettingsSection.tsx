import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { FoliaSettingsPopover } from '@/components/Player/folia/FoliaSettingsPopover'
import {
  LYRIC_DISPLAY_LABELS,
  LYRIC_DISPLAY_MODES,
  LYRIC_MOTION_LABELS,
  LYRIC_MOTION_STYLES,
  LYRIC_TRANSLATION_LABELS,
  LYRIC_TRANSLATION_MODES,
} from '@/components/Player/mineradio/lyrics/lyricDisplayConfig'
import { VISUAL_QUALITIES, VISUAL_QUALITY_LABELS } from '@/components/Player/stages/RenderPolicy'
import { resolveStageFamily } from '@/components/Player/stages/registry'
import { useVisualStageDisabled } from '@/hooks/useVisualStageSupport'
import { useSettingsStore } from '@/stores/settingsStore'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { AmllLyricSettingsGroup, ObsceneMaskSettings } from './AmllLyricSettingsGroup'
import { SettingRow } from './SettingRow'

type PlayerFamily = 'classic' | 'mineradio' | 'folia'

const FAMILY_TABS: { id: PlayerFamily; label: string }[] = [
  { id: 'classic', label: '经典' },
  { id: 'mineradio', label: '3D 视觉' },
  { id: 'folia', label: 'Folia' },
]

/** 换歌过渡只作用于经典舞台的封面/歌名（3D 与 Folia 有各自的换歌呈现）。 */
function SongHandoffSetting() {
  const s = useSettingsStore()
  return (
    <SettingRow
      label="换歌过渡"
      description="每次换歌，封面与歌名做一次约 0.5 秒的交叉淡化，与背景换图同拍；自动混音与普通切歌都生效。"
      onReset={s.songHandoffAnimation !== s.songHandoffAnimationDefault ? s.resetSongHandoffAnimation : undefined}
    >
      <Switch checked={s.songHandoffAnimation} onCheckedChange={s.setSongHandoffAnimation} />
    </SettingRow>
  )
}

function DynamicCoverSetting() {
  const s = useSettingsStore()
  return (
    <SettingRow
      label="动态封面"
      description="播放平台提供的视频封面，封面与 AMLL 背景都会跟随；关闭后始终使用静态封面，减少视频解码与耗电。"
      onReset={s.dynamicCoverEnabled !== s.dynamicCoverEnabledDefault ? s.resetDynamicCoverEnabled : undefined}
    >
      <Switch checked={s.dynamicCoverEnabled} onCheckedChange={s.setDynamicCoverEnabled} />
    </SettingRow>
  )
}

function ClassicSettings() {
  const s = useSettingsStore()
  return (
    <>
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

        <SettingRow
          label="背景渲染器"
          description="对齐 AMLL 上游，环境不支持时自动回退"
          onReset={s.bgRenderer !== s.bgRendererDefault ? s.resetBgRenderer : undefined}
        >
          <Select value={s.bgRenderer} onValueChange={(v) => s.setBgRenderer(v as typeof s.bgRenderer)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mesh">网格渐变渲染器</SelectItem>
              <SelectItem value="pixi">PixiJS 渲染器</SelectItem>
              <SelectItem value="isolation">Isolation 渲染器</SelectItem>
              <SelectItem value="css-bg">CSS 背景</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {s.bgRenderer === 'css-bg' && (
          <SettingRow label="CSS 背景属性值" description="等同于 background 样式，默认 #111111">
            <Input
              value={s.bgCssBackground}
              onChange={(e) => s.setBgCssBackground(e.target.value)}
              className="w-40"
              spellCheck={false}
            />
          </SettingRow>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold">换歌</h3>
        <Separator className="mt-2 mb-4" />
        <SongHandoffSetting />
      </div>

      <div>
        <h3 className="text-base font-semibold">封面</h3>
        <Separator className="mt-2 mb-4" />
        <DynamicCoverSetting />
      </div>

      <div>
        <h3 className="text-base font-semibold">竖屏</h3>
        <Separator className="mt-2 mb-4" />
        <SettingRow
          label="沉浸封面"
          description="封面铺满舞台并在底部渐隐，歌名与控制叠加其上；开启后不再自动进入歌词视图。有动态封面的歌曲始终沉浸。"
          onReset={
            s.classicImmersiveCover !== s.classicImmersiveCoverDefault ? s.resetClassicImmersiveCover : undefined
          }
        >
          <Switch checked={s.classicImmersiveCover} onCheckedChange={s.setClassicImmersiveCover} />
        </SettingRow>
      </div>

      <SettingRow
        label="频谱替代控制按钮"
        description="用音频频谱替换封面下方的播放控制行（AMLL 的 FFT 控制模式）。开启后界面上没有播放/切歌按钮，仍可用空格等快捷键操作。"
        onReset={s.classicControlsFft !== s.classicControlsFftDefault ? s.resetClassicControlsFft : undefined}
      >
        <Switch checked={s.classicControlsFft} onCheckedChange={s.setClassicControlsFft} />
      </SettingRow>

      <SettingRow
        label="歌词自动对齐封面"
        description="横屏时歌词锚点跟随封面中心，竖屏时对齐到顶部歌曲信息下方（AMLL 默认行为）；关闭后使用下方的手动对齐设置。"
        onReset={
          s.classicLyricAutoAlign !== s.classicLyricAutoAlignDefault ? s.resetClassicLyricAutoAlign : undefined
        }
      >
        <Switch checked={s.classicLyricAutoAlign} onCheckedChange={s.setClassicLyricAutoAlign} />
      </SettingRow>

      <AmllLyricSettingsGroup family="classic" />
    </>
  )
}

function MineradioSettings() {
  const s = useSettingsStore()
  return (
    <>
      <div>
        <h3 className="text-base font-semibold">画面</h3>
        <Separator className="mt-2 mb-4" />

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
          label="控制条自动淡出"
          description="停手 3 秒后底部控制条淡到半透明，指针或键盘操作立刻恢复"
          onReset={
            s.stageConsoleAutoFade !== s.stageConsoleAutoFadeDefault ? s.resetStageConsoleAutoFade : undefined
          }
        >
          <Switch checked={s.stageConsoleAutoFade} onCheckedChange={s.setStageConsoleAutoFade} />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词</h3>
        <Separator className="mt-2 mb-4" />

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

        {s.lyricRenderer === 'webgl' && (
          <>
            <SettingRow
              label="歌词显示行数"
              description="影院为 5 行，自定义可选 1-10 行"
              onReset={s.lyricDisplayMode3d !== s.lyricDisplayMode3dDefault ? s.resetLyricDisplayMode3d : undefined}
            >
              <Select value={s.lyricDisplayMode3d} onValueChange={s.setLyricDisplayMode3d}>
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
                  s.lyricCustomLineCount !== s.lyricCustomLineCountDefault ? s.resetLyricCustomLineCount : undefined
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
              <Select value={s.lyricMotion} onValueChange={s.setLyricMotion}>
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
                s.lyricTranslationMode3d !== s.lyricTranslationMode3dDefault ? s.resetLyricTranslationMode3d : undefined
              }
            >
              <Select value={s.lyricTranslationMode3d} onValueChange={s.setLyricTranslationMode3d}>
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
          </>
        )}
      </div>

      {s.lyricRenderer === 'amll' ? (
        <AmllLyricSettingsGroup family="mineradio" />
      ) : (
        <div>
          <h3 className="text-base font-semibold">敏感词</h3>
          <Separator className="mt-2 mb-4" />
          <ObsceneMaskSettings family="mineradio" />
        </div>
      )}
    </>
  )
}

function FoliaSettings() {
  const s = useSettingsStore()
  return (
    <>
      <div>
        <h3 className="text-base font-semibold">样式与调音</h3>
        <Separator className="mt-2 mb-4" />
        <SettingRow label="Folia 播放器设置" description="歌词样式、动效、背景与字幕，打开上游工作窗口">
          <FoliaSettingsPopover>
            <Button variant="outline" className="gap-2">
              <Settings2 className="size-4" />
              打开 Folia 设置
            </Button>
          </FoliaSettingsPopover>
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">画面</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="画质"
          description="与 3D 视觉舞台互相独立；低端硬件会自动压低预算"
          onReset={s.foliaVisualQuality !== s.foliaVisualQualityDefault ? s.resetFoliaVisualQuality : undefined}
        >
          <Select value={s.foliaVisualQuality} onValueChange={s.setFoliaVisualQuality}>
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
          label="帧率"
          description="与经典播放器的背景帧率互相独立"
          onReset={s.foliaFrameRate !== s.foliaFrameRateDefault ? s.resetFoliaFrameRate : undefined}
        >
          <Select value={String(s.foliaFrameRate)} onValueChange={(v) => s.setFoliaFrameRate(parseInt(v, 10))}>
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
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词字体</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="字体粗细"
          description="字体粗细值（100-900），与样式窗口同步"
          onReset={s.foliaLyricFontWeight !== s.foliaLyricFontWeightDefault ? s.resetFoliaLyricFontWeight : undefined}
        >
          <NumericInput value={s.foliaLyricFontWeight} onChange={s.setFoliaLyricFontWeight} min={100} max={900} />
        </SettingRow>

        <SettingRow
          label="字体大小"
          description="主歌词字号比例（10-200），与样式窗口同步"
          onReset={s.foliaLyricFontSize !== s.foliaLyricFontSizeDefault ? s.resetFoliaLyricFontSize : undefined}
        >
          <NumericInput value={s.foliaLyricFontSize} onChange={s.setFoliaLyricFontSize} />
        </SettingRow>

        <SettingRow
          label="字幕字号"
          description="译词/音译字幕相对主歌词的比例（10-200）"
          onReset={
            s.lyricTranslationFontSize !== s.lyricTranslationFontSizeDefault
              ? s.resetLyricTranslationFontSize
              : undefined
          }
        >
          <NumericInput value={s.lyricTranslationFontSize} onChange={s.setLyricTranslationFontSize} />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">渲染质量</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="歌词画布分辨率" description="1× 是各样式原来的清晰度；高于 1× 是超采样，更清晰也更吃显卡">
          <Select
            value={String(s.foliaSettings.renderQuality.scale)}
            onValueChange={(value) =>
              s.setFoliaSettings({
                renderQuality: {
                  ...s.foliaSettings.renderQuality,
                  scale: parseFloat(value) as 0.5 | 0.75 | 1 | 1.5 | 2,
                },
              })
            }
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5×</SelectItem>
              <SelectItem value="0.75">0.75×</SelectItem>
              <SelectItem value="1">1×</SelectItem>
              <SelectItem value="1.5">1.5×</SelectItem>
              <SelectItem value="2">2×</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow label="歌词画布抗锯齿" description="自动是各样式自己的默认；打开时几何边缘更平滑">
          <Select
            value={s.foliaSettings.renderQuality.antialias}
            onValueChange={(value) =>
              s.setFoliaSettings({
                renderQuality: {
                  ...s.foliaSettings.renderQuality,
                  antialias: value as 'auto' | 'on' | 'off',
                },
              })
            }
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动</SelectItem>
              <SelectItem value="on">开</SelectItem>
              <SelectItem value="off">关</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </>
  )
}

export function PlayerSettingsSection() {
  const visualStage = useSettingsStore((s) => s.visualStage)
  const visualStageDisabled = useVisualStageDisabled()
  const activeFamily: PlayerFamily = resolveStageFamily(visualStage) ?? 'classic'
  const [family, setFamily] = useState<PlayerFamily>(activeFamily)
  const families = visualStageDisabled ? FAMILY_TABS.slice(0, 1) : FAMILY_TABS
  const selected = families.some((tab) => tab.id === family) ? family : 'classic'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">播放器设置</h3>
        <Separator className="mt-2 mb-4" />
        <p className="mb-3 text-xs text-muted-foreground">三个播放器各自独立，互不影响。默认显示当前舞台的设置。</p>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {families.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFamily(tab.id)}
              aria-pressed={selected === tab.id}
              className={
                selected === tab.id
                  ? 'flex-1 rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm'
                  : 'flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {selected === 'classic' && <ClassicSettings />}
      {selected === 'mineradio' && <MineradioSettings />}
      {selected === 'folia' && <FoliaSettings />}
    </div>
  )
}
