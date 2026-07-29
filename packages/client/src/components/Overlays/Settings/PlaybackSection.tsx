import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { SYNC_PACKET_INTERVAL_MAX_SECONDS, SYNC_PACKET_INTERVAL_MIN_SECONDS } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useState } from 'react'
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
          description="开启后会在不改变音高的前提下，以最多 ±1% 的速度差平滑消除客户端间的微小时间偏移。关闭后始终以 1.0× 原速播放，并可单独选择是否在偏差过大时直接定位同步。"
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
            description="自动变速关闭时，平滑偏差连续两次超过动态阈值后直接定位同步。阈值最低为 500 ms，高延迟时会提高到中位 RTT + 250 ms。"
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
    </div>
  )
}
