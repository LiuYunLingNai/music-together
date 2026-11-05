import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { SYNC_PACKET_INTERVAL_MAX_SECONDS, SYNC_PACKET_INTERVAL_MIN_SECONDS } from '@/lib/constants'
import {
  AUDIO_CROSSFADE_MAX_MS,
  AUDIO_EQ_BANDS,
  AUDIO_EQ_GAIN_MAX,
  AUDIO_EQ_GAIN_MIN,
  useAudioSettingsStore,
} from '@/stores/audioSettingsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEffect, useState } from 'react'
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
        <h3 className="text-base font-semibold">音频输出</h3>
        <Separator className="mt-2 mb-4" />
        <OutputDeviceSetting />
        <CrossfadeSetting />
      </div>

      <div>
        <h3 className="text-base font-semibold">均衡器</h3>
        <Separator className="mt-2 mb-4" />
        <EqualizerSettings />
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
      void mediaDevices.enumerateDevices()
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
            <SelectItem key={value} value={String(value)}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function EqualizerSettings() {
  const enabled = useAudioSettingsStore((state) => state.equalizerEnabled)
  const gains = useAudioSettingsStore((state) => state.equalizerGains)
  const setEnabled = useAudioSettingsStore((state) => state.setEqualizerEnabled)
  const setGain = useAudioSettingsStore((state) => state.setEqualizerGain)
  const reset = useAudioSettingsStore((state) => state.resetEqualizer)

  return (
    <>
      <SettingRow
        label="启用均衡器"
        description="五段峰值均衡器，作用于实际输出音频；视觉频谱跟随处理后的声音。"
        onReset={enabled || gains.some((gain) => gain !== 0) ? reset : undefined}
      >
        <Switch aria-label="启用均衡器" checked={enabled} onCheckedChange={setEnabled} />
      </SettingRow>
      {AUDIO_EQ_BANDS.map((frequency, index) => (
        <SettingRow key={frequency} label={`${frequency >= 1000 ? `${frequency / 1000}k` : frequency} Hz`}>
          <div className="flex w-52 items-center gap-3">
            <Slider
              aria-label={`${frequency} Hz 增益`}
              min={AUDIO_EQ_GAIN_MIN}
              max={AUDIO_EQ_GAIN_MAX}
              step={1}
              value={[gains[index] ?? 0]}
              disabled={!enabled}
              onValueChange={([gain]) => setGain(index, gain)}
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
              {gains[index] > 0 ? '+' : ''}{gains[index] ?? 0} dB
            </span>
          </div>
        </SettingRow>
      ))}
    </>
  )
}
