import { Copy, Download, Ellipsis, Flame, LogOut, MessageSquare, Search, Settings, Users, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LyricCalibration } from '@/components/Player/LyricCalibration'
import { MusicDownloadDialog } from '@/components/Player/MusicDownloadDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getMedianRTT } from '@/lib/clockSync'
import { useRoomStore } from '@/stores/roomStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useSocketContext } from '@/providers/socket-context'
import { toast } from 'sonner'

interface RoomHeaderProps {
  onOpenSearch: () => void
  onOpenChat: () => void
  onOpenSettings: () => void
  onOpenMembers: () => void
  onOpenHotSongs: () => void
  onLeaveRoom: () => void
  chatUnreadCount: number
}

export function RoomHeader({
  onOpenSearch,
  onOpenChat,
  onOpenSettings,
  onOpenMembers,
  onOpenHotSongs,
  onLeaveRoom,
  chatUnreadCount,
}: RoomHeaderProps) {
  // Fine-grained selectors to avoid re-renders from queue/playState changes
  const roomName = useRoomStore((s) => s.room?.name)
  const roomId = useRoomStore((s) => s.room?.id)
  const userCount = useRoomStore((s) => s.room?.users.length ?? 0)
  const hasCurrentTrack = usePlayerStore((s) => Boolean(s.currentTrack))
  const { isConnected } = useSocketContext()
  const [downloadOpen, setDownloadOpen] = useState(false)

  // Poll RTT from clockSync module every 3s
  const [rtt, setRtt] = useState(0)
  useEffect(() => {
    if (!isConnected) return
    const frame = requestAnimationFrame(() => setRtt(getMedianRTT()))
    const timer = setInterval(() => setRtt(getMedianRTT()), 3000)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
    }
  }, [isConnected])

  const displayedRtt = isConnected ? rtt : 0

  const rttColor = !isConnected
    ? 'text-destructive'
    : displayedRtt < 100
      ? 'text-emerald-500/60'
      : displayedRtt < 300
        ? 'text-yellow-500/60'
        : 'text-destructive/60'

  const copyRoomLink = () => {
    if (roomId) {
      navigator.clipboard.writeText(window.location.href)
      toast.success('房间链接已复制')
    }
  }

  return (
    <header className="flex items-center justify-between border-b border-border/50 bg-background/80 px-2 py-2 backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        {roomId && (
          <>
            <span
              className="max-w-[120px] cursor-pointer truncate text-sm font-semibold text-foreground active:opacity-70 sm:max-w-[200px] sm:cursor-default"
              onClick={copyRoomLink}
            >
              {roomName}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden h-7 gap-1 border-primary/20 bg-primary/5 px-2 font-mono text-xs text-primary sm:flex"
                  onClick={copyRoomLink}
                  aria-label="复制房间链接"
                >
                  {roomId}
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>复制房间链接</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 text-sm text-primary"
                  onClick={onOpenMembers}
                  aria-label="查看成员"
                >
                  <Users className="h-3.5 w-3.5" />
                  {userCount}
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看成员</TooltipContent>
            </Tooltip>
          </>
        )}
        {/* Connection status + RTT indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-1"
              role="status"
              aria-live="polite"
              aria-label={isConnected ? `已连接 · 延迟 ${Math.round(displayedRtt)}ms` : '连接断开，正在重连'}
            >
              {isConnected ? (
                <Wifi className={`h-4 w-4 ${rttColor}`} />
              ) : (
                <WifiOff className="h-4 w-4 animate-pulse text-destructive" />
              )}
              {isConnected && (
                <span className={`font-mono text-xs tabular-nums ${rttColor}`}>{Math.round(displayedRtt)}ms</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isConnected ? `已连接 · 延迟 ${Math.round(displayedRtt)}ms` : '连接断开，正在重连...'}
          </TooltipContent>
        </Tooltip>

      </div>
      <div className="flex items-center gap-0.5 sm:gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 lg:hidden"
              onClick={onOpenHotSongs}
              aria-label="热歌榜"
            >
              <Flame className="h-4 w-4 text-orange-400" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>热歌榜</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 min-h-11 min-w-11 sm:hidden"
              onClick={onOpenChat}
              aria-label="聊天"
            >
              <MessageSquare className="h-4 w-4" />
              {chatUnreadCount > 0 && (
                <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>聊天</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              onClick={onOpenSearch}
              aria-label="搜索点歌"
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>搜索点歌</TooltipContent>
        </Tooltip>

        <LyricCalibration />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 sm:flex"
              onClick={() => setDownloadOpen(true)}
              disabled={!hasCurrentTrack}
              aria-label="下载音乐"
            >
              <Download className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>下载音乐</TooltipContent>
        </Tooltip>

        {/* Desktop: inline settings & leave buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0"
              onClick={onOpenSettings}
              aria-label="设置"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0"
              onClick={onLeaveRoom}
              aria-label="离开房间"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>离开房间</TooltipContent>
        </Tooltip>

        {/* Mobile: dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:hidden sm:min-h-0 sm:min-w-0"
              aria-label="更多操作"
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings className="mr-2 h-4 w-4" />
              设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!hasCurrentTrack} onClick={() => setDownloadOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              下载音乐
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyRoomLink}>
              <Copy className="mr-2 h-4 w-4" />
              复制房间链接
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLeaveRoom}>
              <LogOut className="mr-2 h-4 w-4" />
              离开房间
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <MusicDownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
    </header>
  )
}
