import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveFoliaTuning } from '../../stage/foliaTunings'
import type { FoliaModeId } from '../../registry'
import type { VisualizerBackgroundMode, VisualizerMode } from '../types'
import { resolveSmartBeatSettings, type SmartBeatPatch } from '@/services/beatFx/smartBeatSettings'
import { DEFAULT_SMART_BEAT_SETTINGS } from '@/services/beatFx/beatFxTypes'
import { ensureFoliaAssets, useFoliaAssetStore } from '../../stage/foliaAssetStore'

/**
 * 上游设置窗口读写的三个 store 的宿主版本。
 *
 * 上游 `useVisualizerSettingsStore` / `usePlayerChromeSettingsStore` / `useVisualizerAssetStore`
 * 是它自己的一整套设置域；本仓对应状态在 `settingsStore.foliaSettings` 与 `settingsStore.smartBeat`。
 * 这里做成真正的 zustand store：宿主设置变化时同步进来，动作直接写回宿主，
 * 于是上游面板代码可以原样读 `state.xxx`。
 */

const HOST_MODE_BY_UPSTREAM: Record<string, FoliaModeId> = {
    classic: 'luminous',
    cadenza: 'cadenza',
    partita: 'partita',
    fume: 'fume',
    claddagh: 'claddagh',
    cappella: 'cappella',
    tilt: 'tilt',
    monet: 'monet',
    pendolo: 'pendolo',
    sonnet: 'sonnet',
    tempera: 'tempera',
    lumiere: 'lumiere',
    hanabi: 'hanabi',
    diorama: 'diorama',
    still: 'still',
}
const UPSTREAM_BY_HOST = Object.fromEntries(
    Object.entries(HOST_MODE_BY_UPSTREAM).map(([upstream, host]) => [host, upstream]),
) as Record<FoliaModeId, VisualizerMode>

/** 全部内置歌词样式（宿主 id）。 */
const FOLIA_MODE_IDS = Object.values(HOST_MODE_BY_UPSTREAM)

export const toHostMode = (mode: string): FoliaModeId => HOST_MODE_BY_UPSTREAM[mode] ?? 'luminous'
export const toUpstreamMode = (mode: FoliaModeId): VisualizerMode => UPSTREAM_BY_HOST[mode] ?? 'classic'

const TUNING_MODES: FoliaModeId[] = [
    'luminous', 'cadenza', 'partita', 'fume', 'claddagh', 'cappella',
    'tilt', 'monet', 'pendolo', 'sonnet', 'tempera', 'lumiere', 'hanabi', 'diorama',
]

const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1)

const patchTuning = (mode: FoliaModeId, patch: Record<string, unknown>) => {
    const current = useSettingsStore.getState().foliaSettings
    useSettingsStore.getState().setFoliaSettings({
        tunings: { ...current.tunings, [mode]: { ...(current.tunings[mode] ?? {}), ...patch } },
    })
}

/** 每个模式的调参对象与它的 set / reset 动作，键名与上游 tuning.ts 的声明一致。 */
const tuningState = () => {
    const settings = useSettingsStore.getState().foliaSettings
    const fields: Record<string, unknown> = {}
    for (const mode of TUNING_MODES) {
        const name = mode === 'luminous' ? 'Classic' : capitalize(mode)
        fields[`${mode === 'luminous' ? 'classic' : mode}Tuning`] = resolveFoliaTuning(mode, settings.tunings)
        fields[`handleSet${name}Tuning`] = (patch: Record<string, unknown>) => patchTuning(mode, patch)
        fields[`handleReset${name}Tuning`] = () => {
            const current = useSettingsStore.getState().foliaSettings
            useSettingsStore.getState().setFoliaSettings({ tunings: { ...current.tunings, [mode]: {} } })
        }
    }
    return fields
}

const ownState = () => {
    const settings = useSettingsStore.getState()
    return {
        visualizerMode: toUpstreamMode(settings.visualStage as FoliaModeId),
        visualizerOpacity: 1 - settings.foliaSettings.backgroundDim,
        visualizerBackgroundMode: (settings.foliaSettings.background ?? null) as VisualizerBackgroundMode | null,
        // 每首随机样式（上游 randomVisualizerModePerSong / randomVisualizerModes）。
        randomVisualizerModePerSong: settings.foliaSettings.randomMode,
        randomVisualizerModes: settings.foliaSettings.randomModePool.map(toUpstreamMode) as VisualizerMode[],
        smartBeat: resolveSmartBeatSettings(settings.smartBeat) ?? DEFAULT_SMART_BEAT_SETTINGS,
        // URL 背景：宿主把条目存在 foliaSettings.backgroundConfig.url 里。
        urlBackgroundList: settings.foliaSettings.backgroundConfig.url?.items ?? [],
        urlBackgroundSelectedId: settings.foliaSettings.backgroundConfig.url?.selectedId ?? null,
    }
}

const actions = () => ({
    handleSetVisualizerOpacity: (opacity: number) => {
        useSettingsStore.getState().setFoliaSettings({ backgroundDim: 1 - opacity })
    },
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => {
        useSettingsStore.getState().setFoliaSettings({ background: mode as never })
    },
    // 上游同名动作：写池（按内置清单顺序规整，空池回落全部内置）。
    handleSetRandomVisualizerModes: (modes: readonly VisualizerMode[]) => {
        const selected = new Set(modes)
        const pool = FOLIA_MODE_IDS.filter((id) => selected.has(toUpstreamMode(id)))
        useSettingsStore.getState().setFoliaSettings({
            randomModePool: pool.length > 0 ? pool : [...FOLIA_MODE_IDS],
        })
    },
    handleToggleRandomVisualizerModePerSong: (enable: boolean, options?: { notify?: boolean }) => {
        void options
        useSettingsStore.getState().setFoliaSettings({ randomMode: enable })
    },
    handleSetSmartBeat: (patch: SmartBeatPatch) => useSettingsStore.getState().setSmartBeat(patch),
    handleSetUrlBackgroundList: () => {},
    handleSetUrlBackgroundSelectedId: () => {},
    handleAddUrlBackgroundItem: () => {},
    handleUpdateUrlBackgroundItem: () => {},
    handleDeleteUrlBackgroundItem: () => {},
    handleSelectUrlBackgroundItem: () => {},
    // 上游各样式面板从 settings 里取的素材动作（群唱表情/头像、莫奈人像）：写宿主素材 store。
    handleImportCustomCappellaEmojiPack: (files: File[]) => useFoliaAssetStore.getState().handleImportCustomCappellaEmojiPack(files),
    handleClearCustomCappellaEmojiPack: () => useFoliaAssetStore.getState().handleClearCustomCappellaEmojiPack(),
    handleImportCustomCappellaAvatar: (files: File[]) => useFoliaAssetStore.getState().handleImportCustomCappellaAvatar(files),
    handleClearCustomCappellaAvatar: () => useFoliaAssetStore.getState().handleClearCustomCappellaAvatar(),
    handleUploadMonetPortraitImage: (files: File[]) => useFoliaAssetStore.getState().handleUploadMonetPortraitImage(files),
    handleClearMonetPortraitImage: () => useFoliaAssetStore.getState().handleClearMonetPortraitImage(),
    /**
     * 窗口切换当前样式（上游 handleSetVisualizerMode）：写宿主舞台与歌词模式。
     * 上游语义：手动选一个具体样式时关掉「每首随机」，除非是随机池换样式（preserveRandom）。
     */
    handleSetVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean; preserveRandom?: boolean }) => {
        const host = toHostMode(mode)
        const store = useSettingsStore.getState()
        store.setVisualStage(host as never)
        store.setFoliaSettings({
            lyricMode: host,
            ...(options?.preserveRandom ? {} : { randomMode: false }),
        })
    },
})

export type HostVisualizerSettings = ReturnType<typeof ownState> & ReturnType<typeof actions> & ReturnType<typeof tuningState>

const build = (): HostVisualizerSettings => ({ ...ownState(), ...tuningState(), ...actions() }) as HostVisualizerSettings

export const useVisualizerSettingsStore = create<HostVisualizerSettings>(() => build())

/** 宿主设置一变就同步进窗口的 store（订阅一次，模块级）。 */
let syncing = false
const syncFromHost = () => {
    if (syncing) return
    syncing = true
    useSettingsStore.subscribe(() => {
        useVisualizerSettingsStore.setState(build())
    })
    syncing = false
}
if (typeof window !== 'undefined') syncFromHost()

/** 上游的播放器外壳设置：宿主没有原生模糊背景这一项，恒为 false。 */
export interface HostPlayerChromeSettings {
    enablePlayerPageNativeBlur: boolean
}
export const usePlayerChromeSettingsStore = create<HostPlayerChromeSettings>(() => ({
    enablePlayerPageNativeBlur: false,
}))

export interface HostAssetState {
    cappellaCustomEmojiImages: unknown[]
    cappellaCustomAvatarImages: unknown[]
    monetPortraitImage: unknown | null
    storedMonetPortraitImage: unknown | null
    /** monet 的全局背景覆盖图（与海报人像分开存）。 */
    storedMonetBackgroundImage: unknown | null
    monetBackgroundImage: unknown | null
    isLoadingCappellaCustomEmojiPack: boolean
    isLoadingCappellaCustomAvatarPack: boolean
    isLoadingMonetPortraitImage: boolean
    isLoadingMonetBackgroundImage: boolean
}

/**
 * 上游素材 store：窗口的面板用它判断"有没有自定义素材"并画出预览。
 * 做成真正的 store（而不是直接调用 selector 的普通函数）：上游面板把它当 hook 调用，
 * 直接调用会破坏 hooks 顺序。数据来自宿主的 `foliaAssetStore`（舞台与窗口共用一份），
 * 这里只镜像成上游的字段名。
 */
export const useVisualizerAssetStore = create<HostAssetState>(() => ({
    cappellaCustomEmojiImages: [],
    cappellaCustomAvatarImages: [],
    monetPortraitImage: null,
    storedMonetPortraitImage: null,
    storedMonetBackgroundImage: null,
    monetBackgroundImage: null,
    isLoadingMonetBackgroundImage: true,
    isLoadingCappellaCustomEmojiPack: true,
    isLoadingCappellaCustomAvatarPack: true,
    isLoadingMonetPortraitImage: true,
}))

const mirrorAssets = () => {
    const assets = useFoliaAssetStore.getState()
    useVisualizerAssetStore.setState({
        cappellaCustomEmojiImages: assets.cappellaCustomEmojiImages,
        cappellaCustomAvatarImages: assets.cappellaCustomAvatarImages,
        monetPortraitImage: assets.monetPortraitImage,
        monetBackgroundImage: assets.monetBackgroundImage,
        isLoadingCappellaCustomEmojiPack: assets.isLoadingCappellaCustomEmojiPack,
        isLoadingCappellaCustomAvatarPack: assets.isLoadingCappellaCustomAvatarPack,
        isLoadingMonetPortraitImage: assets.isLoadingMonetPortraitImage,
        isLoadingMonetBackgroundImage: assets.isLoadingMonetBackgroundImage,
    })
}
if (typeof window !== 'undefined') {
    ensureFoliaAssets()
    mirrorAssets()
    useFoliaAssetStore.subscribe(mirrorAssets)
}

/** 上游窗口用 useShallow 取整份设置快照交给草稿机制。 */
export const selectVisualizerSettingsSnapshot = (state: HostVisualizerSettings): HostVisualizerSettings => state
