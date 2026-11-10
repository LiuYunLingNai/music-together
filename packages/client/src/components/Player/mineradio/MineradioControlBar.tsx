import { useEffect, useState } from 'react'
import type { VoteAction, VoteState } from '@music-together/shared'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { VoteBanner } from '../../Vote/VoteBanner'
import { QualityBadge } from '../QualityBadge'
import { QueueButton, TrackMeta, TransportButtons, TransportProgress, VolumeControl } from '../stages/Transport'
import { useTransportActions } from '../stages/useTransportActions'

interface MineradioControlBarProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

/** 停手多久后控制条淡出；任何指针/键盘活动都会立刻唤醒。 */
const IDLE_DELAY_MS = 3000

/**
 * 3D 舞台的底部控制条：两行、信息更轻。
 *
 * 画面本身是主角，所以只保留识别与操控必需的东西 —— 封面、歌名/歌手、
 * 播放三键、音量、队列。聊天与播放模式在视觉舞台里是低频操作，留给侧栏与
 * 设置面板；空闲时整条淡到 45%，指针进入即恢复（可在设置里关闭）。
 */
export function MineradioControlBar({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenQueue,
  activeVote,
  onCastVote,
  onStartVote,
}: MineradioControlBarProps) {
  const actions = useTransportActions({ onPlay, onPause, onSeek, onNext, onPrev, onStartVote })
  const roomQuality = useRoomStore((s) => s.room?.audioQuality)
  const autoFade = useSettingsStore((s) => s.stageConsoleAutoFade)
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!autoFade) return
    let timer = window.setTimeout(() => setIdle(true), IDLE_DELAY_MS)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), IDLE_DELAY_MS)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [autoFade])

  return (
    <>
      {activeVote && (
        <div className="mt-mineradio-vote">
          <VoteBanner vote={activeVote} onCastVote={onCastVote} />
        </div>
      )}
      <div className="mt-mineradio-console">
        <div className="mt-mineradio-console__inner" data-idle={autoFade && idle ? '' : undefined}>
          <TransportProgress disabled={actions.disabled} canSeek={actions.canSeek} onSeek={onSeek} />
          <div className="mt-console-row">
            <div className="mt-console-meta-group">
              <TrackMeta
                track={actions.currentTrack}
                badge={
                  <QualityBadge
                    quality={actions.currentTrack?.audioQuality}
                    bitrate={actions.currentTrack?.audioBitrate}
                    downgraded={actions.currentTrack?.qualityDowngraded}
                    requested={roomQuality}
                  />
                }
              />
            </div>
            <TransportButtons actions={actions} />
            <div className="mt-console-modes">
              <VolumeControl actions={actions} />
              <QueueButton actions={actions} onOpenQueue={onOpenQueue} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
