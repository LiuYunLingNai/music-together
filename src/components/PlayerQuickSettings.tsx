import { RotateCcw, X } from 'lucide-react'
import type { LyricSettings, PlayerVisualSettings } from '../domain/types'
import { DEFAULT_LYRIC_SETTINGS, DEFAULT_PLAYER_VISUAL_SETTINGS } from '../lib/storage'
import { updateBackgroundSettings, updateLyricSettings, updatePlayerVisualSettings } from '../services/runtime'
import { useAppStore } from '../store/app-store'

type Option<T extends string> = { value: T; label: string }

export function PlayerQuickSettings() {
  const visual = useAppStore((state) => state.playerVisualSettings)
  const lyrics = useAppStore((state) => state.lyricSettings)
  const fps = useAppStore((state) => state.backgroundFps)
  const flowSpeed = useAppStore((state) => state.backgroundFlowSpeed)
  const renderScale = useAppStore((state) => state.backgroundRenderScale)
  const set = useAppStore((state) => state.set)
  const qualityPreset = fps >= 55 && renderScale >= 0.9 ? 'high' : fps <= 20 && renderScale <= 0.4 ? 'economy' : 'balanced'
  const updateVisual = <K extends keyof PlayerVisualSettings>(key: K, value: PlayerVisualSettings[K]) => updatePlayerVisualSettings({ [key]: value })
  const updateLyrics = <K extends keyof LyricSettings>(key: K, value: LyricSettings[K]) => updateLyricSettings({ [key]: value })

  return (
    <aside className="player-settings" aria-label="播放器快捷设置">
      <header>
        <div><strong>播放器舞台</strong><span>所有调整即时预览</span></div>
        <button className="icon-button" title="恢复播放器默认设置" aria-label="恢复播放器默认设置" onClick={() => { updatePlayerVisualSettings(DEFAULT_PLAYER_VISUAL_SETTINGS); updateLyricSettings(DEFAULT_LYRIC_SETTINGS); updateBackgroundSettings({ backgroundFps: 60, backgroundFlowSpeed: 1, backgroundRenderScale: 1 }) }}><RotateCcw size={15} /></button>
        <button className="icon-button" title="关闭播放器快捷设置" aria-label="关闭播放器快捷设置" onClick={() => set({ playerQuickSettingsOpen: false })}><X size={16} /></button>
      </header>
      <div className="player-settings__grid">
        <SettingsGroup title="外观">
          <Setting label="显示"><Segment value={visual.layout} options={[{ value: 'split', label: '封面与歌词' }, { value: 'lyrics-only', label: '仅歌词' }]} onChange={(value) => updateVisual('layout', value)} /></Setting>
          <Setting label="沉浸主题色"><Segment value={visual.accentVariant} options={[{ value: 'primary', label: '鲜明' }, { value: 'secondary', label: '柔和' }, { value: 'tertiary', label: '偏色' }]} onChange={(value) => updateVisual('accentVariant', value)} /></Setting>
          <Toggle label="文字阴影" checked={visual.textShadow} onChange={(value) => updateVisual('textShadow', value)} />
          <Setting label="控件隐藏"><Segment value={visual.controlsMode} options={[{ value: 'auto', label: '自动' }, { value: 'always', label: '常显' }, { value: 'hidden', label: '全隐' }]} onChange={(value) => updateVisual('controlsMode', value)} /></Setting>
          <Toggle label="进度条贴底" checked={visual.progressAtBottom} onChange={(value) => updateVisual('progressAtBottom', value)} />
          <Toggle label="进度悬停歌词" checked={visual.progressPreview} onChange={(value) => updateVisual('progressPreview', value)} />
          <Toggle label="显示剩余时间" checked={visual.remainingTime} onChange={(value) => updateVisual('remainingTime', value)} />
        </SettingsGroup>
        <SettingsGroup title="封面">
          <Setting label="形状"><Segment value={visual.coverShape} options={[{ value: 'rounded', label: '圆角' }, { value: 'square', label: '方形' }, { value: 'circle', label: '圆形' }]} onChange={(value) => updateVisual('coverShape', value)} /></Setting>
          <Setting label="水平对齐"><Segment value={visual.coverHorizontalAlign} options={[{ value: 'left', label: '居左' }, { value: 'center', label: '居中' }]} onChange={(value) => updateVisual('coverHorizontalAlign', value)} /></Setting>
          <Setting label="垂直对齐"><Segment value={visual.coverVerticalAlign} options={[{ value: 'bottom', label: '居下' }, { value: 'center', label: '居中' }]} onChange={(value) => updateVisual('coverVerticalAlign', value)} /></Setting>
          <Slider label="封面大小" value={visual.coverScale} min={0.7} max={1.25} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => updateVisual('coverScale', value)} />
          <Toggle label="封面弥散阴影" checked={visual.coverShadow} onChange={(value) => updateVisual('coverShadow', value)} />
        </SettingsGroup>
        <SettingsGroup title="背景">
          <Setting label="类型"><Segment value={visual.backgroundMode} options={[{ value: 'fluid', label: '流体' }, { value: 'blur', label: '模糊' }, { value: 'gradient', label: '渐变' }, { value: 'solid', label: '纯色' }, { value: 'none', label: '无' }]} onChange={(value) => updateVisual('backgroundMode', value)} /></Setting>
          <Setting label="质量预设"><Segment value={qualityPreset} options={[{ value: 'economy', label: '节能' }, { value: 'balanced', label: '平衡' }, { value: 'high', label: '高质量' }]} onChange={(value) => {
            const preset = value === 'high'
              ? { backgroundFps: 60, backgroundRenderScale: 1 }
              : value === 'economy'
                ? { backgroundFps: 15, backgroundRenderScale: 0.35 }
                : { backgroundFps: 30, backgroundRenderScale: 0.5 }
            updateBackgroundSettings(preset)
          }} /></Setting>
          <Toggle label="静态流体" checked={visual.staticFluid} onChange={(value) => updateVisual('staticFluid', value)} />
          <Slider label="暗化" value={visual.backgroundDim} min={0} max={90} step={5} format={(value) => `${value}%`} onChange={(value) => updateVisual('backgroundDim', value)} />
          <Slider label="模糊" value={visual.backgroundBlur} min={0} max={128} step={8} format={(value) => `${value}px`} onChange={(value) => updateVisual('backgroundBlur', value)} />
          <Slider label="流体帧率" value={fps} min={5} max={60} step={5} format={(value) => `${value} FPS`} onChange={(backgroundFps) => updateBackgroundSettings({ backgroundFps })} />
          <Slider label="流动速度" value={flowSpeed} min={0.1} max={2} step={0.1} format={(value) => `${value.toFixed(1)}x`} onChange={(backgroundFlowSpeed) => updateBackgroundSettings({ backgroundFlowSpeed })} />
          <Slider label="渲染精度" value={renderScale} min={0.25} max={1} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(backgroundRenderScale) => updateBackgroundSettings({ backgroundRenderScale })} />
        </SettingsGroup>
        <SettingsGroup title="歌词">
          <Setting label="文本对齐"><Segment value={visual.lyricTextAlign} options={[{ value: 'left', label: '居左' }, { value: 'center', label: '居中' }]} onChange={(value) => updateVisual('lyricTextAlign', value)} /></Setting>
          <Setting label="动画曲线"><Segment value={visual.lyricMotion} options={[{ value: 'smooth', label: '平滑' }, { value: 'sharp', label: '急促' }, { value: 'soft', label: '温和' }, { value: 'easeout', label: '缓出' }]} onChange={(value) => updateVisual('lyricMotion', value)} /></Setting>
          <Toggle label="歌词渐隐" checked={visual.lyricFade} onChange={(value) => updateVisual('lyricFade', value)} />
          <Toggle label="长音辉光" checked={visual.lyricGlow} onChange={(value) => updateVisual('lyricGlow', value)} />
          <Toggle label="非活动歌词模糊" checked={lyrics.blur} onChange={(value) => updateLyrics('blur', value)} />
          <Toggle label="逐字缩放" checked={lyrics.scale} onChange={(value) => updateLyrics('scale', value)} />
          <Slider label="字体大小" value={lyrics.fontSize} min={50} max={140} step={5} format={(value) => `${value}%`} onChange={(value) => updateLyrics('fontSize', value)} />
          <Slider label="翻译大小" value={lyrics.translationFontSize} min={50} max={120} step={5} format={(value) => `${value}%`} onChange={(value) => updateLyrics('translationFontSize', value)} />
          <Setting label="贡献者"><Segment value={visual.contributors} options={[{ value: 'always', label: '常显' }, { value: 'hover', label: '悬停' }, { value: 'never', label: '隐藏' }]} onChange={(value) => updateVisual('contributors', value)} /></Setting>
          <label className="player-setting player-setting--font"><span>自定义字体</span><input value={visual.customFontFamily} placeholder="例如 Microsoft YaHei UI" onChange={(event) => updateVisual('customFontFamily', event.target.value)} /></label>
        </SettingsGroup>
      </div>
    </aside>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section className="player-settings__group"><h3>{title}</h3>{children}</section> }
function Setting({ label, children }: { label: string; children: React.ReactNode }) { return <div className="player-setting"><span>{label}</span>{children}</div> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="player-setting player-setting--toggle"><span>{label}</span><span className="switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /></span></label> }
function Segment<T extends string>({ value, options, onChange }: { value: T; options: Array<Option<T>>; onChange: (value: T) => void }) { return <div className="player-segment">{options.map((option) => <button key={option.value} className={value === option.value ? 'is-selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div> }
function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) { return <label className="player-setting player-setting--slider"><span>{label}<small>{format(value)}</small></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label> }
