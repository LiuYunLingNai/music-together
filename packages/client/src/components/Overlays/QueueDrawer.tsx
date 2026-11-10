import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSocketContext } from '@/providers/socket-context'
import type { BilibiliMetadataSource, AudioQuality, Track } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import { QualityBadge } from '@/components/Player/QualityBadge'
import { useHasHover } from '@/hooks/useHasHover'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useAddToPlaylist } from '@/hooks/useAddToPlaylist'
import { memo, useCallback, useContext, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AbilityContext } from '@/providers/ability-context'
import {
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  ListEnd,
  ListMinus,
  ListPlus,
  ListX,
  Music,
  Play,
  Radio,
  RefreshCw,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { BilibiliMetadataDialog } from './BilibiliMetadataDialog'
import type { MusicSource } from '@music-together/shared'
import { QueueTrackCover } from '@/components/Room/QueueTrackCover'

const EMPTY_QUEUE: Track[] = []

const SOURCE_STYLE: Record<MusicSource, { label: string; className: string }> = {
  netease: { label: '网易', className: 'text-white bg-red-500 ring-red-600/50' },
  tencent: { label: 'QQ', className: 'text-white bg-green-500 ring-green-600/50' },
  kugou: { label: '酷狗', className: 'text-white bg-blue-500 ring-blue-600/50' },
  kugou_concept: { label: '概念版', className: 'text-white bg-sky-500 ring-sky-600/50' },
  bilibili: { label: 'B站', className: 'text-white bg-pink-500 ring-pink-600/50' },
}

interface QueueRowProps {
  track: Track
  index: number
  queueLength: number
  isCurrent: boolean
  isTouch: boolean
  active: boolean
  dismissed: boolean
  canPlay: boolean
  canVote: boolean
  canAdd: boolean
  canReorder: boolean
  canAddToPlaylist: boolean
  canRemoveTrack: boolean
  /** 仅当前播放行有服务端解析出的实际音质。 */
  quality?: AudioQuality
  qualityBitrate?: number | null
  qualityDowngraded?: boolean
  requestedQuality?: AudioQuality
  onActivate: (trackId: string) => void
  onHoverEnd: () => void
  onPlay: (track: Track) => void
  onMetadata: (track: Track) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onInsertAfterCurrent: (track: Track, event: MouseEvent) => void
  onMoveToEnd: (track: Track) => void
  onAddToPlaylist: (track: Track, label: string) => void
  onRemove: (track: Track) => void
}

/**
 * 虚拟列表的一行。操作条只在悬停 / 键盘聚焦 / 触摸激活时挂载：
 * 不再让十几行各常驻一套 Tooltip + backdrop-blur，滚动时也只 reconcile 变化过的行。
 */
const QueueRow = memo(function QueueRow({
  track,
  index,
  queueLength,
  isCurrent,
  isTouch,
  active,
  dismissed,
  canPlay,
  canVote,
  canAdd,
  canReorder,
  canAddToPlaylist,
  canRemoveTrack,
  quality,
  qualityBitrate,
  qualityDowngraded,
  requestedQuality,
  onActivate,
  onHoverEnd,
  onPlay,
  onMetadata,
  onMoveUp,
  onMoveDown,
  onInsertAfterCurrent,
  onMoveToEnd,
  onAddToPlaylist,
  onRemove,
}: QueueRowProps) {
  // 操作条始终在 DOM 里（CSS 负责显隐，滚动时不触发 React）；只有这一行真正拿到
  // 键盘焦点时才让它进入 Tab 顺序，避免整张列表一次挂出上百个不可见按钮。
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const actionTabIndex = keyboardFocus ? 0 : -1

  return (
    <div
      tabIndex={0}
      className={cn(
        'group relative flex h-full items-center gap-2 rounded-lg px-2 transition-colors hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none',
        isCurrent && 'bg-primary/10',
      )}
      onClick={() => {
        if (isTouch) onActivate(track.id)
      }}
      onMouseLeave={() => {
        if (!isTouch) onHoverEnd()
      }}
      onFocusCapture={() => setKeyboardFocus(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setKeyboardFocus(false)
      }}
    >
      {/* Index */}
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>

      {/* Cover + source badge */}
      <div className="relative shrink-0">
        <QueueTrackCover track={track} className="h-9 w-9" />
        {track.source && SOURCE_STYLE[track.source] && (
          <span
            className={cn(
              'absolute -bottom-1 -right-1 rounded px-0.5 text-[8px] font-bold leading-tight ring-1',
              SOURCE_STYLE[track.source].className,
            )}
          >
            {SOURCE_STYLE[track.source].label}
          </span>
        )}
      </div>

      {/* Track info */}
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', isCurrent && 'font-medium text-primary')}>{track.title}</div>
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{track.artist.join(' / ')}</span>
          <QualityBadge
            quality={quality}
            bitrate={qualityBitrate}
            downgraded={qualityDowngraded}
            requested={requestedQuality}
            className="text-[9px] leading-3"
          />
          {track.requestedBy && (
            <Badge
              variant="outline"
              className="h-4 max-w-28 shrink-0 gap-0.5 truncate border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-normal text-primary"
            >
              <User className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{track.requestedBy}</span>
            </Badge>
          )}
        </div>
      </div>

      <div
        className={cn(
          'absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/50 bg-popover px-1 py-0.5',
          'pointer-events-none opacity-0',
          'group-hover:pointer-events-auto group-hover:opacity-100',
          'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          isTouch && active && 'pointer-events-auto opacity-100',
          !isTouch && dismissed && '!pointer-events-none !opacity-0',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {!isCurrent && (canPlay || canVote) && (
          <Button
            variant="ghost"
            size="icon"
            tabIndex={actionTabIndex}
            className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
            onClick={() => onPlay(track)}
            aria-label={canPlay ? `播放 ${track.title}` : `投票播放 ${track.title}`}
            title={canPlay ? '播放' : '投票播放'}
          >
            <Play className="h-3 w-3" />
          </Button>
        )}

        {track.source === 'bilibili' && canAdd && (
          <Button
            variant="ghost"
            size="icon"
            tabIndex={actionTabIndex}
            className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
            onClick={() => onMetadata(track)}
            aria-label={`重选 ${track.title} 的歌词和封面`}
            title="重选歌词和封面"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}

        {canReorder && (
          <>
            <Button
              variant="ghost"
              size="icon"
              tabIndex={actionTabIndex}
              className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
              disabled={index === 0}
              onClick={() => onMoveUp(index)}
              aria-label={`上移 ${track.title}`}
              title="上移"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              tabIndex={actionTabIndex}
              className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
              disabled={index === queueLength - 1}
              onClick={() => onMoveDown(index)}
              aria-label={`下移 ${track.title}`}
              title="下移"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              tabIndex={actionTabIndex}
              className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
              onClick={(event) => onInsertAfterCurrent(track, event)}
              aria-label={`插到当前播放之后 ${track.title}`}
              title="插到当前播放之后"
            >
              <ArrowUpToLine className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              tabIndex={actionTabIndex}
              className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
              disabled={index === queueLength - 1}
              onClick={() => onMoveToEnd(track)}
              aria-label={`移到末尾 ${track.title}`}
              title="移到末尾"
            >
              <ListEnd className="h-3 w-3" />
            </Button>
          </>
        )}

        {canAddToPlaylist && (
          <Button
            variant="ghost"
            size="icon"
            tabIndex={actionTabIndex}
            className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0"
            onClick={() => onAddToPlaylist(track, track.title)}
            aria-label={`将 ${track.title} 加入我的歌单`}
            title="加入我的歌单"
          >
            <ListPlus className="h-3 w-3" />
          </Button>
        )}

        {(canRemoveTrack || canVote) && (
          <Button
            variant="ghost"
            size="icon"
            tabIndex={actionTabIndex}
            className="h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 text-destructive hover:text-destructive"
            onClick={() => onRemove(track)}
            aria-label={canRemoveTrack ? `移除 ${track.title}` : `投票移除 ${track.title}`}
            title={canRemoveTrack ? '移除' : '投票移除'}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
})

interface QueueListProps {
  open: boolean
  queue: Track[]
  currentTrack: Track | null
  isTouch: boolean
  activeTrackId: string | null
  dismissedHoverTrackId: string | null
  requestedQuality?: AudioQuality
  canPlay: boolean
  canVote: boolean
  canAdd: boolean
  canReorder: boolean
  canAddToPlaylist: boolean
  canRemoveTrack: boolean
  onActivate: (trackId: string) => void
  onHoverEnd: () => void
  onPlay: (track: Track) => void
  onMetadata: (track: Track) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onInsertAfterCurrent: (track: Track, event: MouseEvent) => void
  onMoveToEnd: (track: Track) => void
  onAddToPlaylist: (track: Track, label: string) => void
  onRemove: (track: Track) => void
}

/**
 * 虚拟列表独立成层：滚动只重渲染这里，头部与房间状态不再跟着每帧 reconcile。
 */
const QueueList = memo(function QueueList({
  open,
  queue,
  currentTrack,
  isTouch,
  activeTrackId,
  dismissedHoverTrackId,
  requestedQuality,
  canPlay,
  canVote,
  canAdd,
  canReorder,
  canAddToPlaylist,
  canRemoveTrack,
  onActivate,
  onHoverEnd,
  onPlay,
  onMetadata,
  onMoveUp,
  onMoveDown,
  onInsertAfterCurrent,
  onMoveToEnd,
  onAddToPlaylist,
  onRemove,
}: QueueListProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const getItemKey = useCallback((index: number) => queue[index]?.id ?? index, [queue])
  // TanStack Virtual manages mutable measurements internally and cannot be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 56,
    getItemKey,
    overscan: 5,
  })

  // ---- Smart 滚动（上游 WallToolsQueueIsland 的滚动语义）----
  // 打开时把当前歌滚到列表正中；之后切歌时平滑跟随。用户手动滚动时暂停
  // 跟随，几秒后恢复 —— 永远不跟用户抢滚动条。
  const currentIndex = currentTrack ? queue.findIndex((track) => track.id === currentTrack.id) : -1
  const centeredForOpenRef = useRef(false)
  const followTrackIdRef = useRef<string | null>(currentTrack?.id ?? null)
  const userScrollUntilRef = useRef(0)

  // 打开那一帧重置居中标记（关闭期间换的歌也会在下一次打开时居中）。
  useEffect(() => {
    if (open) centeredForOpenRef.current = false
  }, [open])

  useEffect(() => {
    if (!open || currentIndex < 0 || !scrollElement) return

    const centerCurrentTrack = (behavior: ScrollBehavior) => {
      // 行高由虚拟器自己算；不要再乘旧常量（56/64 混用会让索引越大偏得越多）。
      const offset = virtualizer.getOffsetForIndex(currentIndex, 'center')?.[0]
      const target = offset ?? currentIndex * 56
      // 长距离 smooth 会让虚拟列表持续挂载/卸载行，反而更卡；近距离才做平滑。
      const tooFar = Math.abs(target - scrollElement.scrollTop) > scrollElement.clientHeight * 1.5
      scrollElement.scrollTo({ top: Math.max(0, target), behavior: tooFar ? 'auto' : behavior })
    }

    // 打开后的首次定位：等虚拟列表量完一帧再滚（否则 getTotalSize 还是旧值）。
    if (!centeredForOpenRef.current) {
      centeredForOpenRef.current = true
      followTrackIdRef.current = currentTrack?.id ?? null
      const frame = requestAnimationFrame(() => centerCurrentTrack('auto'))
      return () => cancelAnimationFrame(frame)
    }

    // 切歌跟随：手动滚动宽限期内不抢；同一首歌不重复滚。
    const trackId = currentTrack?.id ?? null
    if (trackId === followTrackIdRef.current) return
    followTrackIdRef.current = trackId
    if (Date.now() < userScrollUntilRef.current) return
    centerCurrentTrack('smooth')
  }, [open, currentIndex, currentTrack?.id, scrollElement, virtualizer])

  // 用户手动滚动 → 暂停切歌跟随 4 秒（程序滚动不触发，scrollend 前 wheel/touch 才算）。
  useEffect(() => {
    if (!open || !scrollElement) return
    const markUserScroll = (event: Event) => {
      if (event.isTrusted) userScrollUntilRef.current = Date.now() + 4000
    }
    scrollElement.addEventListener('wheel', markUserScroll, { passive: true })
    scrollElement.addEventListener('touchmove', markUserScroll, { passive: true })
    return () => {
      scrollElement.removeEventListener('wheel', markUserScroll)
      scrollElement.removeEventListener('touchmove', markUserScroll)
    }
  }, [open, scrollElement])

  return (
    <div ref={setScrollElement} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2">
      {queue.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">播放列表为空</div>
      ) : (
        <div className="w-full" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const i = virtualRow.index
            const track = queue[i]
            if (!track) return null
            return (
              <div
                key={track.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  contain: 'layout paint',
                  paddingTop: '8px',
                }}
              >
                <QueueRow
                  track={track}
                  index={i}
                  queueLength={queue.length}
                  isCurrent={currentTrack?.id === track.id}
                  isTouch={isTouch}
                  active={activeTrackId === track.id}
                  dismissed={dismissedHoverTrackId === track.id}
                  canPlay={canPlay}
                  canVote={canVote}
                  canAdd={canAdd}
                  canReorder={canReorder}
                  canAddToPlaylist={canAddToPlaylist}
                  canRemoveTrack={canRemoveTrack}
                  quality={currentTrack?.id === track.id ? currentTrack.audioQuality : undefined}
                  qualityBitrate={currentTrack?.id === track.id ? currentTrack.audioBitrate : null}
                  qualityDowngraded={currentTrack?.id === track.id ? currentTrack.qualityDowngraded : undefined}
                  requestedQuality={requestedQuality}
                  onActivate={onActivate}
                  onHoverEnd={onHoverEnd}
                  onPlay={onPlay}
                  onMetadata={onMetadata}
                  onMoveUp={onMoveUp}
                  onMoveDown={onMoveDown}
                  onInsertAfterCurrent={onInsertAfterCurrent}
                  onMoveToEnd={onMoveToEnd}
                  onAddToPlaylist={onAddToPlaylist}
                  onRemove={onRemove}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

interface QueueDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoveFromQueue: (trackId: string) => void
  onReorderQueue: (trackIds: string[]) => void
  onUpdateBilibiliMetadata: (
    trackId: string,
    metadata:
      | { metadataSource: BilibiliMetadataSource; lyricId?: string; picId?: string; cover: string }
      | { clearMetadata: true },
  ) => void
  onClearQueue: () => void
  /**
   * 外壳形态。`drawer`（默认）是常规抽屉；`island` 是 folia 舞台的
   * 播放栏浮岛 —— 与 folia 胶囊控制栏同语言的暗玻璃卡片，从控制栏
   * 上方浮出（上游 WallToolsQueueIsland 的形态语义），功能完全一致。
   */
  variant?: 'drawer' | 'island'
}

export function QueueDrawer({
  open,
  onOpenChange,
  onRemoveFromQueue,
  onReorderQueue,
  onUpdateBilibiliMetadata,
  onClearQueue,
  variant = 'drawer',
}: QueueDrawerProps) {
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const roomId = useRoomStore((s) => s.room?.id)
  const currentUser = useRoomStore((s) => s.currentUser)
  // 只订阅用到的房间字段：成员进出/播放状态等变化不再把整张虚拟列表重渲染。
  const temporaryAdminUserId = useRoomStore((s) => s.room?.temporaryAdminUserId ?? null)
  const allowTemporaryAdminTrackRemoval = useRoomStore((s) => s.room?.allowTemporaryAdminTrackRemoval ?? false)
  const allowTemporaryAdminQueueClear = useRoomStore((s) => s.room?.allowTemporaryAdminQueueClear ?? false)
  const roamingEnabled = useRoomStore((s) => s.room?.roamingEnabled ?? false)
  const roomAudioQuality = useRoomStore((s) => s.room?.audioQuality)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const { socket } = useSocketContext()
  const isMobile = useIsMobile() // layout: Drawer direction, height
  const hasHover = useHasHover() // interaction: hover vs touch
  const isTouch = !hasHover
  const ability = useContext(AbilityContext)
  const canRemove = ability.can('remove', 'Queue')
  const isTemporaryAdmin = temporaryAdminUserId === currentUser?.id && !currentUser?.isServerAdmin
  const canRemoveTrack = canRemove && (!isTemporaryAdmin || allowTemporaryAdminTrackRemoval)
  const canClearQueue = canRemove && (!isTemporaryAdmin || allowTemporaryAdminQueueClear)
  const canAdd = ability.can('add', 'Queue')
  const canReorder = ability.can('reorder', 'Queue')
  const canPlay = ability.can('play', 'Player')
  const canVote = ability.can('vote', 'Player')
  const canRoam = ability.can('next', 'Player')
  const { addToPlaylist, canUse: canAddToPlaylist } = useAddToPlaylist()
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [confirmCleanPlayed, setConfirmCleanPlayed] = useState(false)
  const cleanPlayedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mobile: track which item has its action toolbar visible
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null)
  // Desktop: after clicking an action, temporarily suppress the hover toolbar until the cursor leaves the item
  const [dismissedHoverTrackId, setDismissedHoverTrackId] = useState<string | null>(null)
  const [metadataTrack, setMetadataTrack] = useState<Track | null>(null)

  // Clear the confirm-dismiss timers on unmount
  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      if (cleanPlayedTimerRef.current) clearTimeout(cleanPlayedTimerRef.current)
    },
    [],
  )

  // 头部只关心“当前曲之前有多少首”；滚动跟随在 QueueList 内独立处理。
  const currentIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1
  const playedCount = currentIndex > 0 ? currentIndex : 0

  const handleRoam = useCallback(() => {
    if (!roamingEnabled) {
      toast.info('请先在房间设置中开启私人漫游')
      return
    }
    const trackId = currentTrack?.id
    socket.emit(EVENTS.PLAYER_NEXT, { ...(trackId ? { trackId } : {}), forceRoaming: true })
    toast('正在获取漫游推荐…')
  }, [roamingEnabled, currentTrack?.id, socket])

  const handleCleanPlayed = useCallback(() => {
    if (!confirmCleanPlayed) {
      setConfirmCleanPlayed(true)
      if (cleanPlayedTimerRef.current) clearTimeout(cleanPlayedTimerRef.current)
      cleanPlayedTimerRef.current = setTimeout(() => {
        cleanPlayedTimerRef.current = null
        setConfirmCleanPlayed(false)
      }, 3000)
      return
    }
    if (cleanPlayedTimerRef.current) {
      clearTimeout(cleanPlayedTimerRef.current)
      cleanPlayedTimerRef.current = null
    }
    setConfirmCleanPlayed(false)
    socket.emit(EVENTS.QUEUE_REMOVE_PLAYED)
    toast.success(`已清理 ${playedCount} 首已播放`)
  }, [confirmCleanPlayed, playedCount, socket])

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      // Auto-dismiss after 3s
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => {
        confirmTimerRef.current = null
        setConfirmClear(false)
      }, 3000)
      return
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    onClearQueue()
    setConfirmClear(false)
    toast.success('播放列表已清空')
  }, [confirmClear, onClearQueue])

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return
      const ids = queue.map((t) => t.id)
      ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
      onReorderQueue(ids)
    },
    [queue, onReorderQueue],
  )

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= queue.length - 1) return
      const ids = queue.map((t) => t.id)
      ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
      onReorderQueue(ids)
    },
    [queue, onReorderQueue],
  )

  // 移到末尾（上游 WallToolsQueueRow 的 moveToEnd 语义）；已是最后一首时是空操作。
  const handleMoveToEnd = useCallback(
    (track: Track) => {
      const ids = queue.map((t) => t.id)
      const from = ids.indexOf(track.id)
      if (from < 0 || from === ids.length - 1) return
      ids.splice(from, 1)
      ids.push(track.id)
      onReorderQueue(ids)
    },
    [queue, onReorderQueue],
  )

  const handlePlayTrack = useCallback(
    (track: Track) => {
      if (canPlay) {
        socket.emit(EVENTS.PLAYER_PLAY, { track })
      } else if (canVote) {
        socket.emit(EVENTS.VOTE_START, {
          action: 'play-track' as const,
          payload: { trackId: track.id, trackTitle: track.title },
        })
        toast.info(`已发起投票：播放「${track.title}」`)
      }
    },
    [canPlay, canVote, socket],
  )

  const handleRemoveTrack = useCallback(
    (track: Track) => {
      if (canRemoveTrack) {
        onRemoveFromQueue(track.id)
        toast.success(`已移除「${track.title}」`)
      } else if (canVote) {
        socket.emit(EVENTS.VOTE_START, {
          action: 'remove-track' as const,
          payload: { trackId: track.id, trackTitle: track.title },
        })
        toast.info(`已发起投票：移除「${track.title}」`)
      }
    },
    [canRemoveTrack, canVote, onRemoveFromQueue, socket],
  )

  const handleActivate = useCallback((trackId: string) => {
    setActiveTrackId((prev) => (prev === trackId ? null : trackId))
  }, [])

  const handleHoverEnd = useCallback(() => {
    setDismissedHoverTrackId(null)
  }, [])

  const handleInsertAfterCurrent = useCallback(
    (track: Track, e?: MouseEvent) => {
      // If this was triggered from inside the floating actions, hide it immediately.
      // - Touch: activeTrackId controls visibility
      // - Desktop: the action bar unmounts as soon as dismissed is set
      if (e) {
        e.stopPropagation()
        ;(e.currentTarget as HTMLButtonElement | null)?.blur()
      }
      if (isTouch) setActiveTrackId((prev) => (prev === track.id ? null : prev))
      if (!isTouch) setDismissedHoverTrackId(track.id)
      const current = currentTrack
      const currentIndex = current?.id ? queue.findIndex((t) => t.id === current.id) : -1

      if (current && track.id === current.id) return

      const ids = queue.map((t) => t.id)
      const from = ids.indexOf(track.id)
      if (from < 0) return

      // 先移除再插入，避免重复
      ids.splice(from, 1)

      if (currentIndex >= 0) {
        // 目标位置：当前播放歌曲的下方（已播放的在上方，不动）
        // 如果被移动的歌曲在 current 之前，移除后 currentIndex 会左移一位
        const adjustedCurrentIndex = from < currentIndex ? currentIndex - 1 : currentIndex
        const to = adjustedCurrentIndex + 1
        ids.splice(to, 0, track.id)
      } else {
        // 无 currentTrack（或 currentTrack 不在队列中）时，退化为置顶到队首
        ids.unshift(track.id)
      }

      onReorderQueue(ids)
      toast.success(`已插到当前播放之后「${track.title}」`)
    },
    [isTouch, currentTrack, queue, onReorderQueue],
  )

  // ---- 外壳 ----
  // island：folia 播放栏上方的浮出卡片（暗玻璃，与 folia-console 同语言）；
  // drawer：常规抽屉。头部/列表/行动作完全共用，仅容器与定位不同。
  const header = (
    <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
        <Music className="h-4 w-4" />
        播放列表 ({queue.length})
        {roamingEnabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-normal text-white/70">
            <Radio className="h-3 w-3" />
            私人漫游
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 hover:bg-white/10 hover:text-white',
                roamingEnabled ? 'text-emerald-300' : 'text-white/70',
              )}
              onClick={handleRoam}
              disabled={!canRoam}
              aria-label="私人漫游：播放一首推荐"
            >
              <Radio className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {roamingEnabled ? '私人漫游：立即播放一首推荐' : '请先在房间设置中开启私人漫游'}
          </TooltipContent>
        </Tooltip>
        {canAddToPlaylist && queue.length > 0 && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => addToPlaylist(queue, '房间队列')}
                aria-label="将播放列表存入我的歌单"
              >
                <ListPlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>存入我的歌单</TooltipContent>
          </Tooltip>
        )}
        {canRemoveTrack && playedCount > 0 && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 text-white/70 hover:bg-white/10 hover:text-white',
                  confirmCleanPlayed && 'text-destructive hover:text-destructive',
                )}
                onClick={handleCleanPlayed}
                aria-label="清理已播放"
              >
                <ListMinus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {confirmCleanPlayed ? '再次点击确认清理' : `清理已播放的 ${playedCount} 首`}
            </TooltipContent>
          </Tooltip>
        )}
        {canClearQueue && queue.length > 0 && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 text-white/70 hover:bg-white/10 hover:text-white',
                  confirmClear && 'text-destructive hover:text-destructive',
                )}
                onClick={handleClear}
                aria-label="清空播放列表"
              >
                <ListX className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{confirmClear ? '再次点击确认清空' : '清空播放列表'}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => onOpenChange(false)}
          aria-label="关闭播放列表"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  const list = (
    <QueueList
      open={open}
      queue={queue}
      currentTrack={currentTrack}
      isTouch={isTouch}
      activeTrackId={activeTrackId}
      dismissedHoverTrackId={dismissedHoverTrackId}
      requestedQuality={roomAudioQuality}
      canPlay={canPlay}
      canVote={canVote}
      canAdd={canAdd}
      canReorder={canReorder}
      canAddToPlaylist={canAddToPlaylist}
      canRemoveTrack={canRemoveTrack}
      onActivate={handleActivate}
      onHoverEnd={handleHoverEnd}
      onPlay={handlePlayTrack}
      onMetadata={setMetadataTrack}
      onMoveUp={handleMoveUp}
      onMoveDown={handleMoveDown}
      onInsertAfterCurrent={handleInsertAfterCurrent}
      onMoveToEnd={handleMoveToEnd}
      onAddToPlaylist={addToPlaylist}
      onRemove={handleRemoveTrack}
    />
  )

  if (variant === 'island') {
    return (
      <div className="folia-queue-island" data-open={open || undefined} aria-hidden={!open}>
        {open && (
          <div className="folia-queue-island__card" role="dialog" aria-label="播放列表">
            {header}
            {list}
          </div>
        )}
        <BilibiliMetadataDialog
          track={metadataTrack}
          roomId={roomId}
          onOpenChange={(isOpen) => !isOpen && setMetadataTrack(null)}
          onSelect={(metadata, metadataSource) => {
            if (!metadataTrack) return
            onUpdateBilibiliMetadata(metadataTrack.id, {
              metadataSource,
              lyricId: metadata.lyricId,
              picId: metadata.picId,
              cover: metadata.cover || metadataTrack.cover,
            })
            setMetadataTrack(null)
          }}
          onSkip={() => {
            if (!metadataTrack) return
            onUpdateBilibiliMetadata(metadataTrack.id, { clearMetadata: true })
            setMetadataTrack(null)
          }}
        />
      </div>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={isMobile ? 'bottom' : 'right'}>
      <DrawerContent className={cn('flex flex-col p-0', isMobile && 'h-[70vh]')}>
        {header}
        {list}
      </DrawerContent>
      <BilibiliMetadataDialog
        track={metadataTrack}
        roomId={roomId}
        onOpenChange={(isOpen) => !isOpen && setMetadataTrack(null)}
        onSelect={(metadata, metadataSource) => {
          if (!metadataTrack) return
          onUpdateBilibiliMetadata(metadataTrack.id, {
            metadataSource,
            lyricId: metadata.lyricId,
            picId: metadata.picId,
            cover: metadata.cover || metadataTrack.cover,
          })
          setMetadataTrack(null)
        }}
        onSkip={() => {
          if (!metadataTrack) return
          onUpdateBilibiliMetadata(metadataTrack.id, { clearMetadata: true })
          setMetadataTrack(null)
        }}
      />
    </Drawer>
  )
}
