import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Track, UserPlaylist, UserPlaylistDetail } from '@music-together/shared'
import type { SettingsTab } from '../SettingsDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore } from '@/stores/accountStore'
import { useAccountPlaylistStore } from '@/stores/accountPlaylistStore'
import { useQueue } from '@/hooks/useQueue'
import {
  createUserPlaylist,
  deleteUserPlaylist,
  fetchUserPlaylistDetail,
  fetchUserPlaylists,
  removeTrackFromUserPlaylist,
  renameUserPlaylist,
} from '@/lib/playlistApi'
import { ArrowLeft, Check, ListMusic, ListPlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'

interface MyPlaylistsSectionProps {
  onNavigate?: (tab: SettingsTab) => void
}

export function MyPlaylistsSection({ onNavigate }: MyPlaylistsSectionProps) {
  const hasPassword = useAccountStore((state) => Boolean(state.profile?.hasPassword))

  if (!hasPassword) {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold">我的歌单</h3>
        <Separator />
        <div className="rounded-lg border border-dashed p-6 text-center">
          <ListMusic className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">本地歌单仅对已登录账号开放。</p>
          <p className="mt-1 text-sm text-muted-foreground">请先在账号里设置密码，即可创建跨音源的个人歌单。</p>
          {onNavigate && (
            <Button className="mt-4" variant="outline" onClick={() => onNavigate('account')}>
              前往账号设置
            </Button>
          )}
        </div>
      </div>
    )
  }

  return <MyPlaylistsContent />
}

function MyPlaylistsContent() {
  const playlists = useAccountPlaylistStore((s) => s.playlists)
  const loaded = useAccountPlaylistStore((s) => s.loaded)
  const setPlaylists = useAccountPlaylistStore((s) => s.setPlaylists)
  const upsertPlaylist = useAccountPlaylistStore((s) => s.upsertPlaylist)
  const removePlaylistFromStore = useAccountPlaylistStore((s) => s.removePlaylist)

  const [loading, setLoading] = useState(false)
  const [creatingName, setCreatingName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    setLoading(true)
    fetchUserPlaylists()
      .then(setPlaylists)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '歌单加载失败'))
      .finally(() => setLoading(false))
  }, [loaded, setPlaylists])

  async function handleCreate() {
    const name = creatingName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      upsertPlaylist(await createUserPlaylist(name))
      setCreatingName('')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '新建歌单失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(id: string) {
    const name = renameValue.trim()
    if (!name) return
    try {
      upsertPlaylist(await renameUserPlaylist(id, name))
      setRenamingId(null)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '重命名失败')
    }
  }

  async function handleDelete(playlist: UserPlaylist) {
    if (!window.confirm(`确定删除歌单「${playlist.name}」？此操作不可撤销。`)) return
    try {
      await deleteUserPlaylist(playlist.id)
      removePlaylistFromStore(playlist.id)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  if (openId) {
    return <PlaylistDetailView playlistId={openId} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">我的歌单</h3>
        <p className="mt-1 text-xs text-muted-foreground">跨音源保存喜欢的歌曲，一键添加到任意房间。</p>
      </div>
      <Separator />

      <div className="flex items-center gap-2">
        <Input
          value={creatingName}
          onChange={(e) => setCreatingName(e.target.value)}
          placeholder="新建歌单…"
          maxLength={100}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreate()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={!creatingName.trim() || creating}
          onClick={() => void handleCreate()}
          aria-label="新建歌单"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载歌单…
        </div>
      ) : playlists.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">还没有歌单，在上方新建一个吧</p>
      ) : (
        <div className="space-y-1">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              {renamingId === playlist.id ? (
                <>
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    maxLength={100}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleRename(playlist.id)
                      } else if (e.key === 'Escape') {
                        setRenamingId(null)
                      }
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => void handleRename(playlist.id)} aria-label="保存">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setRenamingId(null)} aria-label="取消">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenId(playlist.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {playlist.cover ? (
                        <img src={playlist.cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{playlist.name}</span>
                      <span className="block text-xs text-muted-foreground">{playlist.trackCount} 首</span>
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      setRenamingId(playlist.id)
                      setRenameValue(playlist.name)
                    }}
                    aria-label={`重命名 ${playlist.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(playlist)}
                    aria-label={`删除 ${playlist.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlaylistDetailView({ playlistId, onBack }: { playlistId: string; onBack: () => void }) {
  const upsertPlaylist = useAccountPlaylistStore((s) => s.upsertPlaylist)
  const { addTrack, addBatchTracks } = useQueue()
  const [detail, setDetail] = useState<UserPlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchUserPlaylistDetail(playlistId)
      .then((data) => {
        if (active) setDetail(data)
      })
      .catch((error: unknown) => {
        if (!active) return
        toast.error(error instanceof Error ? error.message : '歌单加载失败')
        onBackRef.current()
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [playlistId])

  function handleAddAllToRoom() {
    if (!detail || detail.tracks.length === 0) return
    addBatchTracks(detail.tracks, detail.name)
    toast.success(`已将「${detail.name}」${detail.tracks.length} 首添加到房间`)
  }

  async function handleRemoveTrack(track: Track) {
    if (!detail) return
    try {
      await removeTrackFromUserPlaylist(detail.id, track.id)
      const tracks = detail.tracks.filter((item) => item.id !== track.id)
      const next: UserPlaylistDetail = {
        ...detail,
        tracks,
        trackCount: tracks.length,
        cover: tracks[0]?.thumbnailCover ?? tracks[0]?.cover ?? null,
      }
      setDetail(next)
      const { tracks: _tracks, ...meta } = next
      upsertPlaylist(meta)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '移除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onBack} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{detail?.name ?? '歌单'}</h3>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={!detail || detail.tracks.length === 0}
          onClick={handleAddAllToRoom}
        >
          <ListPlus className="mr-1.5 h-4 w-4" />
          添加到房间
        </Button>
      </div>
      <Separator />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : !detail || detail.tracks.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">歌单还没有歌曲</p>
      ) : (
        <ScrollArea className="max-h-[48vh]">
          <div className="space-y-1 pr-2">
            {detail.tracks.map((track, index) => (
              <div key={track.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {track.thumbnailCover || track.cover ? (
                    <img src={track.thumbnailCover ?? track.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{track.artist.join(' / ')}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    addTrack(track)
                    toast.success(`已添加「${track.title}」到队列`)
                  }}
                  aria-label={`将 ${track.title} 添加到队列`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => void handleRemoveTrack(track)}
                  aria-label={`从歌单移除 ${track.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}