import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { QueueTrackCover } from '@/components/Room/QueueTrackCover'
import { MarqueeText } from '@/components/ui/marquee-text'
import { MiniLyricText } from './MiniLyricText'
import { formatTime } from '@/lib/format'
import { AbilityContext } from '@/providers/ability-context'
import { usePlayerStore } from '@/stores/playerStore'
import type { VoteAction } from '@music-together/shared'
import { ListMusic, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useContext } from 'react'

interface MiniPlayerBarProps {
  onPlay: () => void
  onPause: () => void
  onNext: () => void
  onPrev: () => void
  onStartVote: (action: VoteAction) => void
  onOpenPlaylist: () => void
}

export function MiniPlayerBar({ onPlay, onPause, onNext, onPrev, onStartVote, onOpenPlaylist }: MiniPlayerBarProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const isPlaying = usePlayerStore((state) => state.isPlaying)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const ability = useContext(AbilityContext)
  const canPlay = ability.can('play', 'Player')
  const canVote = ability.can('vote', 'Player')
  const canNext = ability.can('next', 'Player')
  const canPrev = ability.can('prev', 'Player')

  const run = (action: VoteAction, direct: () => void, canDirect: boolean) => {
    if (canDirect) direct()
    else if (canVote) onStartVote(action)
  }

  return (
    <div className="relative z-10 flex min-h-20 shrink-0 items-center gap-3 border-t border-white/10 bg-black/35 px-3 py-2.5 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {currentTrack ? <QueueTrackCover track={currentTrack} className="h-12 w-12 shrink-0 rounded-lg" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-white/5" />}
        <div className="min-w-0">
          <MarqueeText className="text-sm font-medium text-white/90">{currentTrack?.title ?? '暂无歌曲'}</MarqueeText>
          <MarqueeText className="text-xs text-white/45">{currentTrack?.artist.join(' / ') ?? '点击搜索添加歌曲'}</MarqueeText>
        </div>
      </div>
      <MiniLyricText />
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 text-white/70" disabled={!currentTrack || (!canPrev && !canVote)} onClick={() => run('prev', onPrev, canPrev)} aria-label="上一首"><SkipBack className="h-4 w-4" fill="currentColor" /></Button></TooltipTrigger><TooltipContent>上一首</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-10 w-10 rounded-full bg-primary/20 text-primary" disabled={!currentTrack || (!canPlay && !canVote)} onClick={() => run(isPlaying ? 'pause' : 'resume', isPlaying ? onPause : onPlay, canPlay)} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}</Button></TooltipTrigger><TooltipContent>{isPlaying ? '暂停' : '播放'}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 text-white/70" disabled={!currentTrack || (!canNext && !canVote)} onClick={() => run('next', onNext, canNext)} aria-label="下一首"><SkipForward className="h-4 w-4" fill="currentColor" /></Button></TooltipTrigger><TooltipContent>下一首</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 text-white/70 sm:hidden" onClick={onOpenPlaylist} aria-label="打开歌单"><ListMusic className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>打开歌单</TooltipContent></Tooltip>
      </div>
      <button
        type="button"
        className="hidden h-11 w-40 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl text-xs tabular-nums text-white/40 transition-colors hover:bg-white/5 hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:inline-flex"
        onClick={onOpenPlaylist}
        aria-label="打开播放列表"
        title="打开播放列表"
      >
        <ListMusic className="h-4 w-4" />
        {formatTime(currentTime)} / {formatTime(duration)}
      </button>
    </div>
  )
}
