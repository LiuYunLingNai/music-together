import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { SYNC_PACKET_INTERVAL_MAX_SECONDS, SYNC_PACKET_INTERVAL_MIN_SECONDS } from '@/lib/constants'
import {
  AUDIO_EQUALIZER_BANDS,
  AUDIO_EQUALIZER_MAX_GAIN_DB,
  AUDIO_EQUALIZER_MIN_GAIN_DB,
  isAudioEqualizerCustomSlotId,
  type AudioEqualizerModeId,
} from '@/lib/audioEqualizer'
import {
  AUDIO_EFFECT_CONTROLS,
  audioEffectToSliderPosition,
  formatAudioEffectValue,
  sliderPositionToAudioEffect,
} from '@/lib/audioEffects/model'
import { AUDIO_CROSSFADE_MAX_MS, useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'
import { getBeatThisState, loadBeatThisModel, subscribeBeatThisState } from '@/services/analysis/beatThisModel'
import { getHtdemucsState, loadHtdemucsModel, subscribeHtdemucsState } from '@/services/analysis/htdemucsModel'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { SettingRow } from './SettingRow'

function SyncIntervalInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))

  const commit = () => {
    const parsed = Number(draft)
    const nextValue = Number.isFinite(parsed)
      ? Math.max(SYNC_PACKET_INTERVAL_MIN_SECONDS, Math.min(SYNC_PACKET_INTERVAL_MAX_SECONDS, Math.round(parsed)))
      : value
    setDraft(String(nextValue))
    if (nextValue !== value) onChange(nextValue)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={SYNC_PACKET_INTERVAL_MIN_SECONDS}
        max={SYNC_PACKET_INTERVAL_MAX_SECONDS}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(String(value))
        }}
        aria-label="同步数据间隔（秒）"
        className="w-20 text-right"
      />
      <span className="text-sm text-muted-foreground">秒</span>
    </div>
  )
}

export function PlaybackSection() {
  const s = useSettingsStore()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">播放同步</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="自动变速校准"
          description="开启后会在不改变音高的前提下，以最多 ±1% 的速度差平滑消除客户端间的微小时间偏移。关闭后始终以 1.0× 原速播放，并可单独选择是否在偏差过大时直接定位同步。但是开启后有可能导致音质变差。"
          onReset={
            s.playbackTempoSyncEnabled !== s.playbackTempoSyncEnabledDefault
              ? s.resetPlaybackTempoSyncEnabled
              : undefined
          }
        >
          <Switch
            aria-label="自动变速校准"
            checked={s.playbackTempoSyncEnabled}
            onCheckedChange={s.setPlaybackTempoSyncEnabled}
          />
        </SettingRow>

        {!s.playbackTempoSyncEnabled && (
          <SettingRow
            label="大偏差直接同步"
            description="自动变速关闭时，平滑偏差连续两次超过动态阈值后直接定位同步。阈值最低为 500 ms，高延迟时会提高到中位 RTT + 250 ms。如果你的网络环境(延迟)不好 开启后可能导致一直同步导致体验不佳。"
            onReset={
              s.playbackHardSeekSyncEnabled !== s.playbackHardSeekSyncEnabledDefault
                ? s.resetPlaybackHardSeekSyncEnabled
                : undefined
            }
          >
            <Switch
              aria-label="大偏差直接同步"
              checked={s.playbackHardSeekSyncEnabled}
              onCheckedChange={s.setPlaybackHardSeekSyncEnabled}
            />
          </SettingRow>
        )}

        <SettingRow
          label="同步数据间隔"
          description="时钟数据包和播放进度校准包的发送间隔，可设置为 1–60 秒。间隔越长，网络请求越少，但校准偏差的响应会稍慢。"
          onReset={
            s.syncPacketIntervalSeconds !== s.syncPacketIntervalSecondsDefault
              ? s.resetSyncPacketIntervalSeconds
              : undefined
          }
        >
          <SyncIntervalInput
            key={s.syncPacketIntervalSeconds}
            value={s.syncPacketIntervalSeconds}
            onChange={s.setSyncPacketIntervalSeconds}
          />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">睡眠定时器</h3>
        <Separator className="mt-2 mb-4" />
        <SleepTimerSetting />
      </div>

      <div>
        <h3 className="text-base font-semibold">音频输出</h3>
        <Separator className="mt-2 mb-4" />
        <OutputDeviceSetting />
        <CrossfadeSetting />
        <PreloadNextSetting />
        <ReplayGainSetting />
      </div>

      <div>
        <h3 className="text-base font-semibold">均衡器</h3>
        <Separator className="mt-2 mb-4" />
        <EqualizerSettings />
      </div>

      <div>
        <h3 className="text-base font-semibold">音效</h3>
        <Separator className="mt-2 mb-4" />
        <HighPrecisionBeatSetting />
        <TrackFeaturesSetting />
        <HighPrecisionStemSetting />
        <EffectSettings />
      </div>
    </div>
  )
}

function OutputDeviceSetting() {
  const outputDeviceId = useAudioSettingsStore((state) => state.outputDeviceId)
  const setOutputDeviceId = useAudioSettingsStore((state) => state.setOutputDeviceId)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.enumerateDevices) return
    const refresh = () => {
      void mediaDevices
        .enumerateDevices()
        .then((all) => setDevices(all.filter((device) => device.kind === 'audiooutput')))
        .catch(() => setDevices([]))
    }
    refresh()
    mediaDevices.addEventListener?.('devicechange', refresh)
    return () => mediaDevices.removeEventListener?.('devicechange', refresh)
  }, [])

  return (
    <SettingRow
      label="输出设备"
      description="浏览器支持时，把播放音频切到指定的系统输出设备；不支持或未授权时保持系统默认。"
    >
      <Select value={outputDeviceId} onValueChange={setOutputDeviceId}>
        <SelectTrigger size="sm" aria-label="音频输出设备">
          <SelectValue placeholder="系统默认" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">系统默认</SelectItem>
          {devices.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {device.label || `音频输出 ${index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function CrossfadeSetting() {
  const crossfadeMs = useAudioSettingsStore((state) => state.crossfadeMs)
  const setCrossfadeMs = useAudioSettingsStore((state) => state.setCrossfadeMs)
  const options = [
    [0, '关闭'],
    [80, '短淡化（80ms）'],
    [500, '0.5 秒'],
    [1000, '1 秒'],
    [2000, '2 秒'],
    [4000, '4 秒'],
    [AUDIO_CROSSFADE_MAX_MS, '8 秒'],
  ] as const
  return (
    <SettingRow
      label="切歌交叉淡化"
      description="服务端切换歌曲时，旧曲渐弱、新曲渐强。所有房间成员使用同一段过渡，不会各自提前切歌。"
    >
      <Select value={String(crossfadeMs)} onValueChange={(value) => setCrossfadeMs(Number(value))}>
        <SelectTrigger size="sm" aria-label="切歌交叉淡化时长">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([value, label]) => (
            <SelectItem key={value} value={String(value)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function PreloadNextSetting() {
  const enabled = useAudioSettingsStore((state) => state.preloadNextTrack)
  const setEnabled = useAudioSettingsStore((state) => state.setPreloadNextTrack)
  return (
    <SettingRow
      label="预加载下一首"
      description="播放结束前约 25 秒解析并缓冲下一首，减少切歌空档；Bilibili 音源暂不预加载。"
    >
      <Switch aria-label="预加载下一首" checked={enabled} onCheckedChange={setEnabled} />
    </SettingRow>
  )
}

const SLEEP_TIMER_OPTIONS = [
  [0, '关闭'],
  [15, '15 分钟'],
  [30, '30 分钟'],
  [45, '45 分钟'],
  [60, '1 小时'],
  [90, '1.5 小时'],
  [120, '2 小时'],
] as const

function ReplayGainSetting() {
  const mode = useAudioSettingsStore((state) => state.replayGainMode)
  const setMode = useAudioSettingsStore((state) => state.setReplayGainMode)
  return (
    <SettingRow
      label="响度平衡"
      description="按曲目积分响度统一到 -14 LUFS，并对正增益做峰值保护。需要该曲已完成离线分析。"
    >
      <Select value={mode} onValueChange={(value) => setMode(value as 'off' | 'track' | 'auto')}>
        <SelectTrigger size="sm" aria-label="响度平衡模式">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">关闭</SelectItem>
          <SelectItem value="track">单曲响度</SelectItem>
          <SelectItem value="auto">智能平衡</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function SleepTimerSetting() {
  const durationMinutes = useSleepTimerStore((state) => state.durationMinutes)
  const deadlineMs = useSleepTimerStore((state) => state.deadlineMs)
  const setDurationMinutes = useSleepTimerStore((state) => state.setDurationMinutes)
  const arm = useSleepTimerStore((state) => state.arm)
  const disarm = useSleepTimerStore((state) => state.disarm)
  const stopAt =
    deadlineMs === null
      ? null
      : new Date(deadlineMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return (
    <SettingRow
      label="睡眠定时器"
      description={
        stopAt === null
          ? '到期后本机淡出停止，不改变房间播放状态。'
          : `本机将在 ${stopAt} 淡出停止；房间其他人不受影响。`
      }
    >
      <div className="flex items-center gap-2">
        <Select
          value={String(durationMinutes)}
          onValueChange={(value) => {
            const minutes = Number(value)
            setDurationMinutes(minutes)
            if (minutes > 0) arm()
            else disarm()
          }}
        >
          <SelectTrigger size="sm" aria-label="睡眠定时器时长">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLEEP_TIMER_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={String(value)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {deadlineMs !== null && (
          <Button variant="ghost" size="sm" onClick={disarm}>
            取消
          </Button>
        )}
      </div>
    </SettingRow>
  )
}

const PRESET_LABELS: Record<AudioEqualizerModeId, string> = {
  flat: '平直',
  lofi: '低保真',
  radio: '收音机',
  hall: '音乐厅',
  vocal: '人声',
  bass: '低音',
  custom1: '自定义 1',
  custom2: '自定义 2',
}

const EFFECT_LABELS: Record<string, string> = {
  highpass: '低切',
  lowpass: '高切',
  drive: '饱和',
  crush: '降位',
  wow: '抖晃',
  noise: '黑胶底噪',
  width: '立体声宽度',
  space: '空间混响',
  punch: '动态冲击',
}

function EqualizerSettings() {
  const equalizer = useAudioSettingsStore((state) => state.equalizer)
  const setEnabled = useAudioSettingsStore((state) => state.setEqualizerEnabled)
  const setBand = useAudioSettingsStore((state) => state.setEqualizerBand)
  const applyPreset = useAudioSettingsStore((state) => state.applyEqualizerPreset)
  const reset = useAudioSettingsStore((state) => state.resetEqualizer)
  const isCustom = isAudioEqualizerCustomSlotId(equalizer.preset)

  return (
    <>
      <SettingRow
        label="启用均衡器"
        description="十段均衡器与音效作用于实际输出音频；视觉频谱跟随处理后的声音。"
        onReset={isCustom ? reset : undefined}
      >
        <Switch aria-label="启用均衡器" checked={equalizer.enabled} onCheckedChange={setEnabled} />
      </SettingRow>
      <SettingRow label="预设" description="选择内置音色或自定义槽；调整任意频段后会写入自定义槽并开启处理。">
        <Select value={equalizer.preset} onValueChange={(value) => applyPreset(value as AudioEqualizerModeId)}>
          <SelectTrigger size="sm" aria-label="均衡器预设">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      {AUDIO_EQUALIZER_BANDS.map((band, index) => {
        const gain = equalizer.gains[index] ?? 0
        return (
          <SettingRow
            key={band.frequency}
            label={band.frequency >= 1000 ? `${band.frequency / 1000} kHz` : `${band.frequency} Hz`}
          >
            <div className="flex w-52 items-center gap-3">
              <Slider
                aria-label={`${band.label} 频段增益`}
                min={AUDIO_EQUALIZER_MIN_GAIN_DB}
                max={AUDIO_EQUALIZER_MAX_GAIN_DB}
                step={1}
                value={[gain]}
                onValueChange={([next]) => setBand(index, next)}
              />
              <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                {gain > 0 ? '+' : ''}
                {gain} dB
              </span>
            </div>
          </SettingRow>
        )
      })}
    </>
  )
}

function HighPrecisionBeatSetting() {
  const enabled = useAudioSettingsStore((state) => state.highPrecisionBeats)
  const setEnabled = useAudioSettingsStore((state) => state.setHighPrecisionBeats)
  const model = useSyncExternalStore(subscribeBeatThisState, getBeatThisState)
  const description = !enabled
    ? '用 beat_this（WebGPU）识别拍点、下拍与每拍重音，首次开启需下载约 41 MB 权重；不支持时自动回退本地分析。'
    : model.phase === 'downloading'
      ? `正在下载模型权重… ${Math.round(model.progress * 100)}%`
      : model.phase === 'ready'
        ? `已就绪${model.detail ? `（${model.detail}）` : ''}`
        : model.phase === 'unavailable'
          ? `不可用：${model.detail ?? '未知原因'}；已回退本地分析。`
          : '模型尚未加载，下一次分析时开始下载。'
  return (
    <SettingRow label="高精度拍点（实验）" description={description}>
      <Switch
        aria-label="高精度拍点"
        checked={enabled}
        onCheckedChange={(next) => {
          setEnabled(next)
          if (next) void loadBeatThisModel().catch(() => undefined)
        }}
      />
    </SettingRow>
  )
}

function TrackFeaturesSetting() {
  const enabled = useAudioSettingsStore((state) => state.trackFeaturesEnabled)
  const setEnabled = useAudioSettingsStore((state) => state.setTrackFeaturesEnabled)
  return (
    <SettingRow
      label="混音特征分析（实验）"
      description="用混音近似鼓点与人声包络，供 Folia 特效使用；每首歌会多花约 1–3 秒客户端分析时间。"
    >
      <Switch aria-label="混音特征分析" checked={enabled} onCheckedChange={setEnabled} />
    </SettingRow>
  )
}

function HighPrecisionStemSetting() {
  const featuresEnabled = useAudioSettingsStore((state) => state.trackFeaturesEnabled)
  const enabled = useAudioSettingsStore((state) => state.highPrecisionStems)
  const setEnabled = useAudioSettingsStore((state) => state.setHighPrecisionStems)
  const model = useSyncExternalStore(subscribeHtdemucsState, getHtdemucsState)
  const description = !featuresEnabled
    ? '先开启「混音特征分析」；开启后可用 htdemucs 真分轨替代混音近似。'
    : !enabled
      ? '用 htdemucs（WebGPU）分出鼓轨与人声轨，鼓点与人声包络更准；首次开启需下载约 92 MB 权重，不支持时自动回退。'
      : model.phase === 'downloading'
        ? `正在下载分轨模型… ${Math.round(model.progress * 100)}%`
        : model.phase === 'ready'
          ? `已就绪${model.detail ? `（${model.detail}）` : ''}`
          : model.phase === 'unavailable'
            ? `不可用：${model.detail ?? '未知原因'}；已回退混音近似。`
            : '模型尚未加载，下一次特征分析时开始下载。'
  return (
    <SettingRow label="真实分轨（实验）" description={description}>
      <Switch
        aria-label="真实分轨"
        checked={enabled}
        disabled={!featuresEnabled}
        onCheckedChange={(next) => {
          setEnabled(next)
          if (next) void loadHtdemucsModel().catch(() => undefined)
        }}
      />
    </SettingRow>
  )
}

function EffectSettings() {
  const equalizer = useAudioSettingsStore((state) => state.equalizer)
  const setEffect = useAudioSettingsStore((state) => state.setEqualizerEffect)

  return (
    <>
      {AUDIO_EFFECT_CONTROLS.map((control) => {
        const value = equalizer.effects[control.id]
        return (
          <SettingRow
            key={control.id}
            label={EFFECT_LABELS[control.id] ?? control.id}
            description={control.addsNoise ? '这一项会叠加自身底噪，音乐越轻越明显。' : undefined}
          >
            <div className="flex w-52 items-center gap-3">
              <Slider
                aria-label={`${EFFECT_LABELS[control.id] ?? control.id} 强度`}
                min={0}
                max={1000}
                step={1}
                value={[audioEffectToSliderPosition(control, value)]}
                onValueChange={([position]) => setEffect(control.id, sliderPositionToAudioEffect(control, position))}
              />
              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                {formatAudioEffectValue(control, value)}
              </span>
            </div>
          </SettingRow>
        )
      })}
    </>
  )
}
