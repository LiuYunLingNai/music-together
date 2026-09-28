import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { UserPlaylist } from '@music-together/shared'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountPlaylistStore } from '@/stores/accountPlaylistStore'
import { addTracksToUserPlaylist, createUserPlaylist, fetchUserPlaylists } from '@/lib/playlistApi'
import { ListMusic, Loader2, Plus } from 'lucide-react'

export function AddToPlaylistDialog() {
  const pickerTracks = useAccountPlaylistStore((s) => s.pickerTracks)
  const pickerLabel = useAccountPlaylistStore((s) => s.pickerLabel)
  const playlists = useAccountPlaylistStore((s) => s.playlists)
  const loaded = useAccountPlaylistStore((s) => s.loaded)
  const setPlaylists = useAccountPlaylistStore((s) => s.setPlaylists)
  const upsertPlaylist = useAccountPlaylistStore((s) => s.upsertPlaylist)
  const closePicker = useAccountPlaylistStore((s) => s.closePicker)

  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const open = pickerTracks !== null
  const trackCount = pickerTracks?.length ?? 0

  useEffect(() => {
    if (!open || loaded) return
    setLoading(true)
    fetchUserPlaylists()
      .then(setPlaylists)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '歌单加载失败'))
      .finally(() => setLoading(false))
  }, [open, loaded, setPlaylists])

  async function handleAdd(playlist: UserPlaylist) {
    if (!pickerTracks || busyId) return
    setBusyId(playlist.id)
    try {
      const { added, trackCount: total } = await addTracksToUserPlaylist(playlist.id, pickerTracks)
      const skipped = trackCount - added
      // 服务端 list 已缓存（loaded），不会再自动刷新——手动把最新曲目数与封面写回 store，
      // 否则列表和选择器会一直停留在创建时的「0 首」。
      upsertPlaylist({
        ...playlist,
        trackCount: total,
        cover: playlist.cover ?? pickerTracks[0]?.thumbnailCover ?? pickerTracks[0]?.cover ?? null,
      })
      toast.success(
        skipped > 0
          ? `已加入「${playlist.name}」${added} 首（${skipped} 首已存在）`
          : `已加入「${playlist.name}」${added} 首`,
      )
      closePicker()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '加入歌单失败')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const playlist = await createUserPlaylist(name)
      upsertPlaylist(playlist)
      setNewName('')
      await handleAdd(playlist)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '新建歌单失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && closePicker()}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>加入我的歌单</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {pickerLabel ? `${pickerLabel} · ` : ''}共 {trackCount} 首
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新建歌单并加入…"
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
              disabled={!newName.trim() || creating}
              onClick={() => void handleCreate()}
              aria-label="新建歌单并加入"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          <ScrollArea className="max-h-72">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载歌单…
              </div>
            ) : playlists.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">还没有歌单，在上方新建一个吧</p>
            ) : (
              <div className="space-y-1 pr-2">
                {playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handleAdd(playlist)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
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
                    {busyId === playlist.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={closePicker}>
            取消
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
