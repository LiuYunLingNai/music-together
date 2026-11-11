import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Gauge, ListMusic, Palette, Settings2, Shield, Type, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { RoomSettingsSection } from './Settings/RoomSettingsSection'
import { MembersSection } from './Settings/MembersSection'
import { MyPlaylistsSection } from './Settings/MyPlaylistsSection'
import { PlayerSettingsSection } from './Settings/PlayerSettingsSection'
import { LyricsSection } from './Settings/LyricsSection'
import { AccountSection } from './Settings/AccountSection'
import { AdminSection } from './Settings/AdminSection'
import { PlaybackSection } from './Settings/PlaybackSection'
import { useAccountStore } from '@/stores/accountStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsTab =
  | 'room'
  | 'members'
  | 'playback'
  | 'playlists'
  | 'account'
  | 'player'
  | 'lyrics'
  | 'admin'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdateSettings: (settings: {
    name?: string
    password?: string | null
    audioQuality?: import('@music-together/shared').AudioQuality
    hidden?: boolean
    permanent?: boolean
    allowTemporaryAdminTrackRemoval?: boolean
    allowTemporaryAdminQueueClear?: boolean
    removePlayedTracks?: boolean
    roamingEnabled?: boolean
    automixEnabled?: boolean
    transitionMode?: import('@music-together/shared').TransitionMode
    crossfadeMaxSec?: number
    automixPerformance?: boolean
    roamingSource?: import('@music-together/shared').RoamingSource
    roamingMode?: import('@music-together/shared').NeteaseRoamingMode
  }) => Promise<boolean>
  onSetUserRole?: (userId: string, role: 'admin' | 'member') => void
  onKickUser?: (userId: string, ban: boolean) => void
  onUnbanUser?: (userId: string) => void
  initialTab?: SettingsTab
}

// ---------------------------------------------------------------------------
// Nav Item
// ---------------------------------------------------------------------------

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

const BASE_TABS: { id: SettingsTab; icon: LucideIcon; label: string }[] = [
  { id: 'room', icon: Settings2, label: '房间' },
  { id: 'members', icon: Users, label: '成员' },
  { id: 'playback', icon: Gauge, label: '播放' },
  { id: 'player', icon: Palette, label: '播放器' },
  { id: 'lyrics', icon: Type, label: '歌词' },
  { id: 'playlists', icon: ListMusic, label: '我的歌单' },
  { id: 'account', icon: UserRound, label: '账号' },
]

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

export function SettingsDialog({
  open,
  onOpenChange,
  onUpdateSettings,
  onSetUserRole,
  onKickUser,
  onUnbanUser,
  initialTab,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('room')
  const isServerAdmin = useAccountStore((state) => state.profile?.role === 'admin')
  const tabs = useMemo(
    () => (isServerAdmin ? [...BASE_TABS, { id: 'admin' as const, icon: Shield, label: '服务器管理' }] : BASE_TABS),
    [isServerAdmin],
  )

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => setTab(initialTab ?? 'room'))
    return () => cancelAnimationFrame(frame)
  }, [open, initialTab])

  useEffect(() => {
    if (tab !== 'admin' || isServerAdmin) return
    const frame = requestAnimationFrame(() => setTab('room'))
    return () => cancelAnimationFrame(frame)
  }, [isServerAdmin, tab])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="gap-0 p-0 md:max-w-[75vw] lg:max-w-[60vw]">
        <ResponsiveDialogDescription className="sr-only">调整房间、歌词和其他设置</ResponsiveDialogDescription>
        <div className="flex h-[70vh] flex-col md:flex-row">
          {/* Mobile: top tab bar */}
          <div className="flex shrink-0 flex-col border-b md:hidden">
            <ResponsiveDialogTitle className="px-4 pt-4 pb-2 text-lg font-semibold">设置</ResponsiveDialogTitle>
            <nav className="scrollbar-hide flex gap-1 overflow-x-auto px-4 pb-2" role="tablist" aria-label="设置分类">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    tab === t.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Desktop: left side nav */}
          <nav className="hidden w-48 shrink-0 flex-col border-r p-4 md:flex" role="tablist" aria-label="设置分类">
            <ResponsiveDialogTitle className="mb-4 px-3 text-lg font-semibold">设置</ResponsiveDialogTitle>
            <div className="space-y-1">
              {tabs.map((t) => (
                <NavItem key={t.id} icon={t.icon} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />
              ))}
            </div>
          </nav>

          <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 sm:p-6">
                {tab === 'room' && <RoomSettingsSection onUpdateSettings={onUpdateSettings} />}
                {tab === 'members' && (
                  <MembersSection
                    onSetUserRole={onSetUserRole}
                    onKickUser={onKickUser}
                    onUnbanUser={onUnbanUser}
                  />
                )}
                {tab === 'playback' && <PlaybackSection onOpenRoomSettings={() => setTab('room')} />}
                {tab === 'playlists' && <MyPlaylistsSection onNavigate={setTab} />}
                {tab === 'account' && <AccountSection />}
                {tab === 'admin' && isServerAdmin && <AdminSection />}
                {tab === 'lyrics' && <LyricsSection />}
                {tab === 'player' && <PlayerSettingsSection />}
              </div>
            </ScrollArea>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
