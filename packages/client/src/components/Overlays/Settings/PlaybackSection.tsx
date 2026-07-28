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
          description="开启后会在不改变音高的前提下，以最多 ±1% 的速度差平滑消除客户端间的微小时间偏移。关闭后始终以 1.0× 原速播放；网络抖动造成的偏差不会被平滑追回，偏差过大时仍会直接定位来重新校准。"
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
