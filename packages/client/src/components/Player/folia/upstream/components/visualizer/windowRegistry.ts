/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect, react-hooks/refs, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- 上游 folia-major 原样移植：这些规则是宿主 React Compiler 的额外约束，逐条改写会偏离上游实现，故按文件豁免。 */
import type React from 'react'
import { FOLIA_MODES, type FoliaModeId } from '../../../registry'
import { MODE_SETTINGS_PANELS } from './windowPanels'
import { createElement } from 'react'
import { FOLIA_MODE_RENDERERS } from '../../../renderers'
import { getFoliaTuningProps } from '../../../stage/foliaTunings'
import type { Theme, VisualizerMode } from '../../types'

/**
 * 上游 `visualizer/registry.tsx` 的查询面 —— 设置窗口只用到这几项。
 *
 * 上游的注册表是用 `import.meta.glob` 扫各模式 `entry.tsx` 建起来的，条目里带着
 * 渲染器、快捷控件与调参读取器；宿主没有那套 entry（模式由 `folia/renderers.ts` 懒加载，
 * 调参由 `foliaTunings.ts` 解析），所以这里只按同一份模式清单给出窗口需要的元数据。
 */
export interface WindowVisualizerEntry {
    mode: VisualizerMode
    order: number
    labelFallback: string
    previewSeed: string
    previewStartOffset: number
    ownFontSizeNoticeKey?: string
    /** 上游各 entry 的图标；宿主没有这套图标，给 undefined 让窗口回落到通用图标。 */
    glyph?: React.ReactNode
    /** 该模式自己的参数面板（上游 entry.tsx 的 renderSettingsPanel）。 */
    renderSettingsPanel?: (props: Record<string, unknown>) => React.ReactNode
    /** 该模式声明的拍点效果，窗口在「歌词动画」页顶部单列。 */
    beatEffects?: readonly { id: string; nameKey: string; descKey: string; source: 'beats' | 'drums'; retired?: boolean }[]
}

export type VisualizerRegistryEntry = WindowVisualizerEntry
export type VisualizerSettingsPanelProps = Record<string, unknown>

const HOST_BY_UPSTREAM: Record<string, FoliaModeId> = {
    classic: 'luminous', cadenza: 'cadenza', partita: 'partita', fume: 'fume',
    claddagh: 'claddagh', cappella: 'cappella', tilt: 'tilt', monet: 'monet',
    pendolo: 'pendolo', sonnet: 'sonnet', tempera: 'tempera', lumiere: 'lumiere',
    hanabi: 'hanabi', diorama: 'diorama', still: 'still',
}

/** 只有 fume 在上游有预览起点偏移（见其 entry.tsx）；花火等其余都是 0。 */
const PREVIEW_OFFSETS: Partial<Record<FoliaModeId, number>> = { fume: 18.4 }

export const WINDOW_VISUALIZER_ENTRIES: WindowVisualizerEntry[] = FOLIA_MODES.map((mode) => {
    const upstream = (Object.keys(HOST_BY_UPSTREAM).find((key) => HOST_BY_UPSTREAM[key] === mode.id) ?? 'classic') as VisualizerMode
    return {
        mode: upstream,
        order: mode.order,
        labelFallback: mode.label,
        previewSeed: upstream,
        previewStartOffset: PREVIEW_OFFSETS[mode.id] ?? 0,
        ...(mode.id === 'hanabi' ? { ownFontSizeNoticeKey: 'options.hanabiFontSizeAutoNotice' } : {}),
        ...(MODE_SETTINGS_PANELS[upstream] ? { renderSettingsPanel: MODE_SETTINGS_PANELS[upstream] } : {}),
    }
}).sort((left, right) => left.order - right.order)

/** 上游的内置模式清单（随机样式池用它判断"全开"）。 */
export const BUILTIN_VISUALIZER_MODES = WINDOW_VISUALIZER_ENTRIES.map((entry) => entry.mode)

export { WINDOW_VISUALIZER_ENTRIES as VISUALIZER_REGISTRY }

const BY_MODE = new Map(WINDOW_VISUALIZER_ENTRIES.map((entry) => [entry.mode, entry]))

export const getVisualizerRegistryEntry = (mode: VisualizerMode): WindowVisualizerEntry =>
    BY_MODE.get(mode) ?? WINDOW_VISUALIZER_ENTRIES[0]

export const hasVisualizerMode = (mode: string | null | undefined): mode is VisualizerMode =>
    Boolean(mode && BY_MODE.has(mode as VisualizerMode))

/** 上游 entry 的渲染函数：宿主按模式懒加载的同一个组件。 */
export const renderVisualizerMode = (mode: string, props?: Record<string, unknown>) => {
    const host = HOST_BY_UPSTREAM[mode] ?? 'luminous'
    return createElement(FOLIA_MODE_RENDERERS[host as FoliaModeId] as never, props ?? null)
}

export const getVisualizerModeLabel = (mode: VisualizerMode, _t: (key: string) => string): string =>
    getVisualizerRegistryEntry(mode).labelFallback

/** 上游按模式给预览一个固定的随机种子，同一模式每次进入布局一致。 */
export const getVisualizerScopedSeed = (mode: VisualizerMode, scope: string): string =>
    `${scope}-${getVisualizerRegistryEntry(mode).previewSeed}`

/** 上游 `applyVisualizerTuning(mode, props)`：把调参并入 props。宿主用 tuning props 做同一件事。 */
export const applyVisualizerTuning = (
    mode: VisualizerMode,
    props: Record<string, unknown> & { theme?: Theme },
): Record<string, unknown> => {
    const host = HOST_BY_UPSTREAM[mode]
    if (!host || !props.theme) return props
    return { ...props, ...getFoliaTuningProps(host, { tunings: {} } as never) }
}

export type { FoliaModeId }
