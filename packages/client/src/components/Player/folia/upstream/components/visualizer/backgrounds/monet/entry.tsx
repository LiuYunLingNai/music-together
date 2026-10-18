import { DEFAULT_MONET_BACKGROUND_TUNING } from '../../../../types';
import MonetBackgroundLayer, { resolveMonetSourceUrl } from './MonetBackgroundLayer';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/monet/entry.tsx
// Registers the Monet image-treatment shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const monetBackgroundEntry = defineVisualizerBackground({
    mode: 'monet',
    order: 20,
    labelKey: 'options.visualizerBackgroundModeMonet',
    labelFallback: 'Monet',
    // 莫奈：整幅画面被一条斜线分成两种处理
    glyph: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M20.5 8.5L8 19.5" opacity="0.55" />
        </>
    ),
    /*
     * 上游的 `renderSettingsPanel` / `renderQuickControls` / `resetSettings` 未搬：它们依赖上游的
     * `VisualizerTuningSettings` store 与 `QuickControlChip`。本项目的背景设置直接读 `settingsStore`
     * （`FoliaBackgroundSettings.tsx`），没有这条注册通路。
     */
    // The picture is made from the cover, or from the uploaded image where that comes first. The theme
    // colours change in place, with the picture's own crossfade.
    song: ({ config, coverUrl }) => [
        resolveMonetSourceUrl(coverUrl, config?.customImage, config?.monet?.tuning ?? DEFAULT_MONET_BACKGROUND_TUNING),
    ],
    render: ({ config, coverUrl, theme, isDaylight, staticMode }) => (
        <MonetBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            theme={theme}
            isDaylight={isDaylight}
            tuning={config?.monet?.tuning}
            transparentBackground={config?.transparent}
            staticMode={staticMode}
        />
    ),
});

export default monetBackgroundEntry;
