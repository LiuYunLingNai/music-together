import { Suspense, lazy, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import { useFoliaTheme, useFoliaLines } from './stage/lyricAdapter'
import { isFoliaModeId } from './registry'
import { toUpstreamMode, useVisualizerSettingsStore } from './upstream/adapters/hostStores'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'
import { useFoliaAssetStore } from './stage/foliaAssetStore'

/**
 * 上游歌词样式工作窗口（`visualizer/window/VisPlayground`）的宿主壳层。
 *
 * 窗口本身按上游原样搬入，props 面很大（样式、字体、字幕、背景、调音草稿……）。
 * 这里只负责把宿主的 `settingsStore` / `playerStore` / 歌词适配层映射成那些 props：
 *   · 样式与调参 → `foliaSettings.tunings`（经 `resolveFoliaTuning` 合并默认值）；
 *   · 字号 → 宿主 `lyricFontSize`（百分数，以 90 为基准换算成倍率）；
 *   · 字幕 → `showTranslation` / `showRomanization` 与字幕字号；
 *   · 背景 → `foliaSettings.backgroundConfig`。
 * 宿主没有的能力（自定义字体上传、每首随机样式）给出显式空实现，窗口里对应的控件保持禁用态。
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
    const _lines = useFoliaLines()
    void _lines

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
        const common = settings.backgroundConfig.common
        const patchCommon = (patch: Record<string, unknown>) =>
            setSettings({
                backgroundConfig: {
                    ...settings.backgroundConfig,
                    common: { ...common, ...patch },
                },
            })
        const assets = useFoliaAssetStore.getState()
        return {
            onModeChange: (mode: string) => setSettings({ background: mode as never }),
            common: {
                onCoverColorChange: (useCoverColorBg: boolean) => patchCommon({ useCoverColorBg }),
                onOpacityChange: (opacity: number) => patchCommon({ opacity }),
                onDisableGeometricChange: (disableGeometricBackground: boolean) => patchCommon({ disableGeometricBackground }),
                onDisableVignetteChange: (disableVignette: boolean) => patchCommon({ disableVignette }),
            },
            customImage: {
                onUpload: assets.handleUploadMonetBackgroundImage,
                onClear: assets.handleClearMonetBackgroundImage,
                isLoading: isLoadingMonetBackgroundImage,
            },
        } as never
    }, [isLoadingMonetBackgroundImage, settings.backgroundConfig, setSettings])

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
                visualizerOpacity={1}
                backgroundConfig={backgroundConfig}
                backgroundActions={backgroundActions}
                hideTranslationSubtitle={false}
                showSubtitleTranslation={settings.showTranslation}
                subtitleContentMode={
                    settings.showTranslation
                        ? settings.showRomanization ? 'both' : 'translation'
                        : settings.showRomanization ? 'romanization' : 'none'
                }
                subtitleOverlayOpacity={1}
                subtitleOverlayBackground={false}
                subtitleUpcomingLyricsBlur={false}
                showHarmonySubtitle
                harmonySubtitleBackground={false}
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
                    showTranslation: mode !== 'none',
                    showRomanization: mode === 'both' || mode === 'romanization',
                })}
                onClose={onClose}
            />
        </Suspense>,
        document.body,
    )
}
