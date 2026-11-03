import { Suspense, lazy, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import { useFoliaTheme } from './stage/lyricAdapter'
import { isFoliaModeId } from './registry'
import { toUpstreamMode, useVisualizerSettingsStore } from './upstream/adapters/hostStores'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'
import { useFoliaAssetStore } from './stage/foliaAssetStore'
import { sanitizeUrlBackgroundItem } from './upstream/utils/urlBackground'
import type { UrlBackgroundItem } from './upstream/types'
import type { VisualizerBackgroundConfig } from './upstream/components/visualizer/backgrounds/definition'

/**
 * 上游歌词样式工作窗口（`visualizer/window/VisPlayground`）的宿主壳层。
 *
 * 窗口本身按上游原样搬入，props 面很大（样式、字体、字幕、背景、调音草稿……）。
 * 这里只负责把宿主的 `settingsStore` / `playerStore` / 歌词适配层映射成那些 props：
 *   · 样式与调参 → `foliaSettings.tunings`（经 `resolveFoliaTuning` 合并默认值）；
 *   · 字号 → 宿主 `lyricFontSize`（百分数，以 90 为基准换算成倍率）；
 *   · 字幕 → `showTranslation` / `showRomanization` 与字幕字号；
 *   · 背景 → `foliaSettings.backgroundConfig`。
 * 宿主没有的能力（自定义字体上传与字体族选择）给出显式空实现，窗口里对应的控件保持禁用态。
 * 「每首随机样式」由窗口直接读宿主 store（`randomMode` / `randomModePool`），与播放页同一份。
 */
const VisPlayground = lazy(() => import('./upstream/components/visualizer/window/VisPlayground'))

export interface FoliaStyleWindowProps {
    open: boolean
    onClose: () => void
}

/**
 * 窗口的单例宿主：挂在舞台之外（`AudioPlayer` 层级），开关由 `foliaStyleWindowStore` 驱动。
 * 这样切换歌词样式只重渲染舞台，窗口不受影响。
 */
export function FoliaStyleWindowHost() {
    const open = useFoliaStyleWindowStore((state) => state.open)
    const setOpen = useFoliaStyleWindowStore((state) => state.setOpen)
    if (!open) return null
    return <FoliaStyleWindow open onClose={() => setOpen(false)} />
}

export function FoliaStyleWindow({ open, onClose }: FoliaStyleWindowProps) {
    const theme = useFoliaTheme()
    const settings = useSettingsStore((state) => state.foliaSettings)
    const stage = useSettingsStore((state) => state.visualStage)
    const setSettings = useSettingsStore((state) => state.setFoliaSettings)
    const lyricFontSize = useSettingsStore((state) => state.lyricFontSize)
    const setLyricFontSize = useSettingsStore((state) => state.setLyricFontSize)
    const lyricFontWeight = useSettingsStore((state) => state.lyricFontWeight)
    const setLyricFontWeight = useSettingsStore((state) => state.setLyricFontWeight)
    const subtitleFontSize = useSettingsStore((state) => state.lyricTranslationFontSize)
    const setSubtitleFontSize = useSettingsStore((state) => state.setLyricTranslationFontSize)

    const visualizerMode = isFoliaModeId(stage) ? toUpstreamMode(stage) : 'classic'
    // 背景配置：窗口按 config.mode 决定展示哪一个背景的参数卡片。
    // `customImage` 是莫奈/漫游的全局覆盖图，来自素材 store（与舞台同一份）。
    const monetBackgroundImage = useFoliaAssetStore((state) => state.monetBackgroundImage)
    const isLoadingMonetBackgroundImage = useFoliaAssetStore((state) => state.isLoadingMonetBackgroundImage)
    const backgroundConfig = useMemo(
        () => ({
            ...settings.backgroundConfig,
            mode: settings.background,
            customImage: monetBackgroundImage,
        }) as never,
        [monetBackgroundImage, settings.backgroundConfig, settings.background],
    )
    const backgroundActions = useMemo(() => {
        // 都从 store 现取：一次点击里可能连调两个动作（添加网页背景后立刻选中它），
        // 闭包里捕获的旧配置会把前一步写掉。
        const latestConfig = () => useSettingsStore.getState().foliaSettings.backgroundConfig
        const patchConfig = (patch: (config: VisualizerBackgroundConfig) => VisualizerBackgroundConfig) =>
            setSettings({ backgroundConfig: patch(latestConfig()) })
        const patchCommon = (patch: Record<string, unknown>) =>
            patchConfig((config) => ({ ...config, common: { ...config.common, ...patch } }))
        // 各背景自己的调参（latent/monet/nomand/sora）：上游由各 tuning.ts 声明，宿主统一写回
        // `backgroundConfig[id].tuning`，归一化交给 setFoliaSettings。
        const patchBackgroundTuning = (id: 'latent' | 'monet' | 'nomand' | 'sora', patch: Record<string, unknown>) =>
            patchConfig((config) => {
                const slots = config as unknown as Record<string, { tuning?: Record<string, unknown> } | undefined>
                return { ...config, [id]: { ...slots[id], tuning: { ...slots[id]?.tuning, ...patch } } } as never
            })
        // 「恢复默认」：丢掉这一背景保存的调参，卡片与渲染器回到各自的上游默认值。
        const resetBackgroundTuning = (id: 'latent' | 'monet' | 'nomand' | 'sora') =>
            patchConfig((config) => {
                const next = { ...config } as Record<string, unknown>
                delete next[id]
                return next as never
            })
        // 嵌入网页背景的列表与选中项。
        type UrlSlot = { items: UrlBackgroundItem[]; selectedId: string | null }
        const setUrl = (patch: (url: UrlSlot) => UrlSlot) =>
            patchConfig((config) => ({
                ...config,
                url: patch({ items: config.url?.items ?? [], selectedId: config.url?.selectedId ?? null }),
            }) as never)
        return {
            onModeChange: (mode: string) => setSettings({ background: mode as never }),
            common: {
                onCoverColorChange: (useCoverColorBg: boolean) => patchCommon({ useCoverColorBg }),
                onOpacityChange: (opacity: number) => patchCommon({ opacity }),
                onDisableGeometricChange: (disableGeometricBackground: boolean) => patchCommon({ disableGeometricBackground }),
                onDisableVignetteChange: (disableVignette: boolean) => patchCommon({ disableVignette }),
            },
            latent: {
                onTuningChange: (patch: Record<string, unknown>) => patchBackgroundTuning('latent', patch),
                onResetTuning: () => resetBackgroundTuning('latent'),
            },
            monet: {
                onTuningChange: (patch: Record<string, unknown>) => patchBackgroundTuning('monet', patch),
                onResetTuning: () => resetBackgroundTuning('monet'),
            },
            nomand: {
                onTuningChange: (patch: Record<string, unknown>) => patchBackgroundTuning('nomand', patch),
                onResetTuning: () => resetBackgroundTuning('nomand'),
            },
            sora: {
                onTuningChange: (patch: Record<string, unknown>) => patchBackgroundTuning('sora', patch),
                onResetTuning: () => resetBackgroundTuning('sora'),
            },
            url: {
                onAdd: (item: unknown) => {
                    const sanitized = sanitizeUrlBackgroundItem(item)
                    if (!sanitized) return
                    setUrl((url) => ({ ...url, items: [...url.items, sanitized] }))
                },
                onUpdate: (id: string, patch: Record<string, unknown>) =>
                    setUrl((url) => ({
                        ...url,
                        items: url.items.map((item) =>
                            item.id === id ? sanitizeUrlBackgroundItem({ ...item, ...patch, id: item.id }) ?? item : item,
                        ),
                    })),
                onDelete: (id: string) =>
                    setUrl((url) => {
                        const items = url.items.filter((item) => item.id !== id)
                        return { items, selectedId: url.selectedId === id ? items[0]?.id ?? null : url.selectedId }
                    }),
                onSelect: (id: string | null) => setUrl((url) => ({ ...url, selectedId: id })),
            },
            customImage: {
                onUpload: (files: File[]) => useFoliaAssetStore.getState().handleUploadMonetBackgroundImage(files),
                onClear: () => useFoliaAssetStore.getState().handleClearMonetBackgroundImage(),
                isLoading: isLoadingMonetBackgroundImage,
            },
        } as never
    }, [isLoadingMonetBackgroundImage, setSettings])

    if (!open) return null

    // 窗口用 `fixed` 铺满视口；Folia 控制栏上带 backdrop-blur 的祖先会建立新的包含块，
    // 让 fixed 退化成相对那条窄栏（实测高度只剩 46px）。挂到 body 上避免这个问题。
    return createPortal(
        <Suspense fallback={null}>
            <VisPlayground
                theme={theme}
                isDaylight={false}
                visualizerMode={visualizerMode}
                initialEditSection="visualizer"
                visualizerOpacity={1 - settings.backgroundDim}
                backgroundConfig={backgroundConfig}
                backgroundActions={backgroundActions}
                hideTranslationSubtitle={false}
                showSubtitleTranslation={settings.showTranslation}
                subtitleContentMode={
                    settings.showTranslation
                        ? settings.showRomanization ? 'both' : 'translation'
                        : settings.showRomanization ? 'romanization' : 'none'
                }
                subtitleOverlayLayout={settings.subtitleOverlayLayout}
                onSubtitleOverlayLayoutChange={(layout) => setSettings({ subtitleOverlayLayout: layout })}
                subtitleOverlayOpacity={settings.subtitleOverlayOpacity}
                onSubtitleOverlayOpacityChange={(opacity) => setSettings({ subtitleOverlayOpacity: opacity })}
                subtitleOverlayBackground={settings.subtitleOverlayBackground}
                onToggleSubtitleOverlayBackground={(enabled) => setSettings({ subtitleOverlayBackground: enabled })}
                subtitleUpcomingLyricsBlur={settings.subtitleUpcomingLyricsBlur}
                onToggleSubtitleUpcomingLyricsBlur={(enabled) => setSettings({ subtitleUpcomingLyricsBlur: enabled })}
                showHarmonySubtitle={settings.showHarmonySubtitle}
                onToggleShowHarmonySubtitle={(enabled) => setSettings({ showHarmonySubtitle: enabled })}
                harmonySubtitleBackground={settings.harmonySubtitleBackground}
                onToggleHarmonySubtitleBackground={(enabled) => setSettings({ harmonySubtitleBackground: enabled })}
                fontStyle={theme.fontStyle}
                fontScale={lyricFontSize / 90}
                subtitleFontScale={subtitleFontSize / 90}
                fontWeight={lyricFontWeight ?? null}
                customFontFamily={null}
                customFontLabel={null}
                onFontStyleChange={() => {}}
                onFontScaleChange={(scale) => setLyricFontSize(Math.round(scale * 90))}
                onSubtitleFontScaleChange={(scale) => setSubtitleFontSize(Math.round(scale * 90))}
                onFontWeightChange={(weight) => setLyricFontWeight(weight ?? 600)}
                onCustomFontChange={() => {}}
                // 上游语义：在样式架上选一个具体样式即关掉「每首随机」。
                onVisualizerModeChange={(mode) => useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode)}
                onVisualizerOpacityChange={(opacity) => setSettings({ backgroundDim: 1 - opacity })}
                onToggleShowSubtitleTranslation={(shown) => setSettings({ showTranslation: shown })}
                onSubtitleContentModeChange={(mode) => setSettings({
                    showTranslation: mode === 'translation' || mode === 'both',
                    showRomanization: mode === 'romanization' || mode === 'both',
                })}
                onClose={onClose}
            />
        </Suspense>,
        document.body,
    )
}
