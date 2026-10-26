import { create } from 'zustand'

/**
 * 歌词样式窗口的开关状态。
 *
 * 上游窗口是独立工作窗口，不在播放器树里；本仓如果把它挂在 `FoliaControlBar` 内部，
 * 每次切换歌词样式（`visualStage` 变化）都会让整个 `FoliaPlayerStage` 连同窗口一起
 * 重新渲染 —— 用户看到的就是「设置窗口闪退重进一遍」。
 *
 * 因此开关放进这个独立 store，窗口本体由 `FoliaStyleWindowHost` 在舞台之外渲染一次。
 */
interface FoliaStyleWindowStore {
    open: boolean
    setOpen: (open: boolean) => void
}

export const useFoliaStyleWindowStore = create<FoliaStyleWindowStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}))
