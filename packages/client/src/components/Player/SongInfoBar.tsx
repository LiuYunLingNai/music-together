import { ArtistNames } from '@/components/ArtistNames'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSongHandoff } from '@/hooks/useSongHandoff'
import { useTrackLike } from '@/hooks/useTrackLike'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { Heart, MessageSquare, Volume2, VolumeX } from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useCallback, useRef, useState } from 'react'
import { SONG_INFO_TRANSITION } from './constants'
import { QualityBadge } from './QualityBadge'
import { SongTextCrossfade } from './SongTextCrossfade'

/**
 * 与 PlayerControls 的 300px 设计宽度同一套比例，改用容器查询单位换算：
 * 内层不再使用 CSS `zoom`，文字共享元素才能在同一坐标系里形变。
 * 基准字号 16 * W / 300，其余尺寸一律用 em 派生。
 */
const ROW_FONT_SIZE = '5.333cqw'

/**
 * 音量控制组件：解决 Tooltip + Popover 共享 trigger 时 tooltip 闪现的问题。
 * 核心策略：Popover 打开时通过 `open={false}` 强制隐藏外层 Tooltip。
 */
function VolumeControl({
  volume,
  setVolume,
  toggleMute,
}: {
  volume: number
  setVolume: (v: number) => void
  toggleMute: () => void
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)

  return (
    <Tooltip delayDuration={300} open={popoverOpen ? false : undefined}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-[2.25em] w-[2.25em] text-[1em] text-primary/75 hover:bg-primary/10 hover:text-primary active:scale-90 transition-transform"
              aria-label={volume === 0 ? '取消静音' : '调节音量'}
            >
              {volume === 0 ? <VolumeX className="size-[1.25em]" /> : <Volume2 className="size-[1.25em]" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>音量</TooltipContent>
        <PopoverContent side="top" align="center" className="flex w-44 items-center gap-2 rounded-xl px-3 py-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-primary/75" onClick={toggleMute}>
            {volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <Slider min={0} max={100} value={[volume * 100]} onValueChange={([v]) => setVolume(v / 100)} />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-white/50">{Math.round(volume * 100)}</span>
        </PopoverContent>
      </Popover>
    </Tooltip>
  )
}

interface SongInfoBarProps {
  onOpenChat: () => void
  chatUnreadCount: number
  /** 竖屏顶部已有聊天入口，信息栏里的重复按钮关掉。 */
  showChat?: boolean
}

export const SongInfoBar = memo(function SongInfoBar({
  onOpenChat,
  chatUnreadCount,
  showChat = true,
}: SongInfoBarProps) {
  const handoff = useSongHandoff()
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const roomQuality = useRoomStore((s) => s.room?.audioQuality)
  const like = useTrackLike(currentTrack)
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const prevVolumeRef = useRef(0.8)

  const toggleMute = useCallback(() => {
    if (volume === 0) {
      setVolume(prevVolumeRef.current)
    } else {
      prevVolumeRef.current = volume
      setVolume(0)
    }
  }, [volume, setVolume])

  return (
    <div className="w-full" style={{ containerType: 'inline-size' }}>
      <div className="flex w-full items-end gap-[0.5em]" style={{ fontSize: ROW_FONT_SIZE }}>
        {/* Left: song title + artist — layoutId 与竖屏歌词页头部共享形变 */}
        <motion.div layoutId="song-info" transition={SONG_INFO_TRANSITION} className="min-w-0 flex-1">
          <div className="text-[1.25em] font-bold leading-tight text-white/90">
            <SongTextCrossfade
              text={handoff.to?.title ?? '暂无歌曲'}
              from={handoff.from?.title ?? null}
              token={handoff.token}
            />
          </div>
          <div className="flex min-w-0 items-center gap-[0.4em] text-[0.875em] text-white/50">
            <div className="min-w-0">
              <SongTextCrossfade
                text={handoff.to ? handoff.to.artist.join(' / ') : '点击搜索添加歌曲到队列'}
                from={handoff.from ? handoff.from.artist.join(' / ') : null}
                token={handoff.token}
                content={handoff.to ? <ArtistNames track={handoff.to} className="hover:text-white" /> : undefined}
              />
            </div>
            <QualityBadge
              quality={currentTrack?.audioQuality}
              bitrate={currentTrack?.audioBitrate}
              downgraded={currentTrack?.qualityDowngraded}
              requested={roomQuality}
              className="text-[0.62em] leading-[1.5]"
            />
          </div>
        </motion.div>

        {/* Right-bottom: volume + chat buttons (always visible, aligned to bottom) */}
        <div className="flex shrink-0 items-center">
          {like.available && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-[2.25em] w-[2.25em] text-[1em] text-primary/75 hover:bg-primary/10 hover:text-primary"
                    onClick={() => void like.toggle()}
                    disabled={like.busy}
                    aria-label={like.liked ? '取消喜欢' : '喜欢'}
                    aria-pressed={like.liked}
                  >
                    <Heart className="size-[1.25em]" fill={like.liked ? 'currentColor' : 'none'} />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{like.liked ? '取消喜欢' : '喜欢到网易云'}</TooltipContent>
            </Tooltip>
          )}
          <VolumeControl volume={volume} setVolume={setVolume} toggleMute={toggleMute} />
          {showChat && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-[2.25em] w-[2.25em] text-[1em] text-primary/75 hover:bg-primary/10 hover:text-primary"
                    onClick={onOpenChat}
                    aria-label="聊天"
                  >
                    <MessageSquare className="size-[1.25em]" />
                    {chatUnreadCount > 0 && (
                      <span className="absolute -right-[0.4em] -top-[0.4em] flex h-[1.6em] min-w-[1.6em] items-center justify-center rounded-full bg-white/90 px-[0.4em] text-[0.625em] font-semibold leading-none text-black">
                        {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                      </span>
                    )}
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>聊天</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
})
