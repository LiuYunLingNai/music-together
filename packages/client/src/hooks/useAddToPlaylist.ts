import { useCallback } from 'react'
import { toast } from 'sonner'
import type { Track } from '@music-together/shared'
import { useAccountStore } from '@/stores/accountStore'
import { useAccountPlaylistStore } from '@/stores/accountPlaylistStore'

/**
 * 打开「加入我的歌单」选择器。本地歌单仅对已登录账号开放，访客点击时给出引导提示，
 * 不打开选择器。返回的 `canUse` 可用于决定入口是否展示。
 */
export function useAddToPlaylist() {
  const hasPassword = useAccountStore((state) => Boolean(state.profile?.hasPassword))
  const openPicker = useAccountPlaylistStore((state) => state.openPicker)

  const addToPlaylist = useCallback(
    (tracks: Track | Track[], label?: string) => {
      if (!hasPassword) {
        toast.info('本地歌单仅对已登录账号开放，请先在账号设置里设置密码')
        return
      }
      const list = Array.isArray(tracks) ? tracks : [tracks]
      if (list.length === 0) return
      openPicker(list, label)
    },
    [hasPassword, openPicker],
  )

  return { addToPlaylist, canUse: hasPassword }
}
