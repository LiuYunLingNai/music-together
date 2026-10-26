import type { ReactNode } from 'react'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'

/**
 * Folia 设置入口。
 *
 * 上游的歌词样式设置是一个独立工作窗口（左侧实时预览 + 右侧五页签）。窗口本体由
 * `FoliaStyleWindowHost` 在舞台之外渲染一次，这里只负责把各个按钮接到它的开关上 ——
 * 否则窗口会随 `visualStage` 变化跟着舞台一起重渲染（表现为切样式时窗口“闪退重进”）。
 */
export function FoliaSettingsPopover({ children }: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; side?: 'top' | 'bottom' }) {
  const open = useFoliaStyleWindowStore((state) => state.setOpen)
  return <span onClick={() => open(true)}>{children}</span>
}

export type { FoliaStyleWindowProps } from './FoliaStyleWindow'
