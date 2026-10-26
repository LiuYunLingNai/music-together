import { createContext, useEffect, useState } from 'react'
import { usePlayerStore } from '@/stores/playerStore'

/**
 * 上游设置窗口引用的其余宿主小模块的替身：媒体查询、底部栏布局、可用性探测、
 * 随机模式类型。宿主没有同名模块，这里给出同形状的最小实现。
 */

/** 上游 `hooks/useMediaQuery`。 */
export const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(() =>
        typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? false : window.matchMedia(query).matches)
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const list = window.matchMedia(query)
        const update = () => setMatches(list.matches)
        update()
        list.addEventListener('change', update)
        return () => list.removeEventListener('change', update)
    }, [query])
    return matches
}

/** 上游 `floating-player/PlayerBottomBarLayoutContext`：预览不需要真实底部栏，给常量。 */
export const PreviewBottomBarOffsetContext = createContext<number | null>(null)
export const PLAYER_BOTTOM_BAR_BASE_OFFSET_PX = 32
export const PLAYER_SUBTITLE_BOTTOM_PX = 56
export const resolveUnscaledSubtitleBarOffset = (_scale?: number, _below?: unknown, fallback = PLAYER_SUBTITLE_BOTTOM_PX) => fallback

/** 上游 `hooks/useSmartBeatAvailability`：本仓的拍点来自离线分析，只要在播就算可用。 */
export const useSmartBeatAvailability = (mode: string): string => {
    void mode
    const playing = usePlayerStore((state) => state.isPlaying)
    return playing ? 'ready' : 'idle'
}

/** 上游 `utils/randomVisualizerModes` 的类型，窗口只用作模式 id 列表。 */
export type RandomVisualizerMode = string

/** 上游 `stores/useStatusMessageStore`：窗口用它弹一句提示，宿主没有全局状态条，改为 console。 */
export const setStatusMessage = (message: string | { type: string; text: string }) => console.info('[folia]', message)

/** 上游设置窗口的子视图 id（宿主的设置弹窗没有这套子视图，仅作类型）。 */
export type SettingsSubviewId = string

/** 从池里挑一个不同于当前的样式（上游同语义）。 */
export const pickRandomVisualizerMode = (pool: readonly string[], exclude?: string): string => {
    const candidates = pool.filter(mode => mode !== exclude)
    const source = candidates.length > 0 ? candidates : pool
    return source[Math.floor(Math.random() * source.length)]
}

/** 上游 windowRegistry 的预览起点偏移（fume 18.4s，其余 0），由 PreviewPlaceholder 读取。 */
export const getVisualizerPreviewStartOffset = (mode: string, loop: number): number =>
    (mode === 'fume' ? 18.4 : 0) % loop
