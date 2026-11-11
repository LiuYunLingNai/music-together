import { useRoomStore } from '@/stores/roomStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useChatStore } from '@/stores/chatStore'
import { useArtistPageStore } from '@/stores/artistPageStore'
import { useAccountPlaylistStore } from '@/stores/accountPlaylistStore'
import { resetClockSync } from '@/lib/clockSync'

/** Reset all room-related stores at once (used on leave/disconnect) */
export function resetAllRoomState() {
  useRoomStore.getState().reset()
  usePlayerStore.getState().reset()
  useChatStore.getState().reset()
  useArtistPageStore.getState().close()
  // 关闭可能残留的「加入歌单」选择器（账号级歌单缓存本身保留）。
  useAccountPlaylistStore.getState().closePicker()
  resetClockSync()
}
