import { useQueue } from '@/hooks/useQueue'
import { QueueDrawer } from '@/components/Overlays/QueueDrawer'

/**
 * folia 舞台的播放列表浮岛。
 *
 * QueueDrawer 的 `island` 变体在这里挂载（folia-root 内）—— 需要 folia 的
 * `--folia-bar-offset` 定位变量与舞台坐标系，浮出位置才与播放栏对齐。
 * 队列动作与抽屉同源（useQueue 的 socket 直发 + 投票回退），行为完全一致；
 * 这里只负责在 folia 舞台内把它渲染出来。
 */
export function FoliaQueueIsland({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { removeTrack, reorderTracks, updateBilibiliMetadata, clearQueue } = useQueue()

  return (
    <QueueDrawer
      open={open}
      onOpenChange={onOpenChange}
      onRemoveFromQueue={removeTrack}
      onReorderQueue={reorderTracks}
      onUpdateBilibiliMetadata={updateBilibiliMetadata}
      onClearQueue={clearQueue}
      variant="island"
    />
  )
}
