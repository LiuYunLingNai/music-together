import { VoteBanner } from '../../Vote/VoteBanner'
import { MineradioTransport } from './MineradioTransport'
import type { VoteAction, VoteState } from '@music-together/shared'

interface MineradioControlBarProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  chatUnreadCount: number
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

/**
 * 底部悬浮玻璃控制台。
 *
 * 内容使用自建的 `MineradioTransport`（三列 grid，参照 Mineradio 的
 * `#controls` 结构），而不是复用经典播放器的窄列组件 ——
 * 后者的 `zoom = clientWidth / 300` 缩放假设与横向胶囊不兼容。
 *
 * 播放、权限、投票行为沿用同一套 store 与 Ability，因此语义不变。
 */
export function MineradioControlBar({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenChat,
  onOpenQueue,
  chatUnreadCount,
  activeVote,
  onCastVote,
  onStartVote,
}: MineradioControlBarProps) {
  return (
    <>
      {activeVote && (
        <div className="mt-mineradio-vote">
          <VoteBanner vote={activeVote} onCastVote={onCastVote} />
        </div>
      )}

      <div className="mt-mineradio-console">
        <div className="mt-mineradio-console__inner">
          <MineradioTransport
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
            onNext={onNext}
            onPrev={onPrev}
            onOpenQueue={onOpenQueue}
            onOpenChat={onOpenChat}
            onStartVote={onStartVote}
            chatUnreadCount={chatUnreadCount}
          />
        </div>
      </div>
    </>
  )
}
