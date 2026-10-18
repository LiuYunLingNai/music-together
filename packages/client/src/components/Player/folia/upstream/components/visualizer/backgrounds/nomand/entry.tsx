import { DEFAULT_NOMAND_BACKGROUND_TUNING } from '../../../../types';
import NomandBackgroundLayer, { resolveNomandSourceUrl } from './NomandBackgroundLayer';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/nomand/entry.tsx
// Registers the Paper image-effect shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const nomandBackgroundEntry = defineVisualizerBackground({
    mode: 'nomand',
    order: 30,
    labelKey: 'options.visualizerBackgroundModeNomand',
    labelFallback: 'Nomand',
    // 漫游：像素块
    glyph: (
        <>
            <rect x="4" y="4" width="6.5" height="6.5" rx="0.8" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="0.8" />
        </>
    ),
    command: {
        title: 'Background: Nomand',
        description: 'Switch background to theme-colored image dithering',
        keywords: ['nomand', 'dithering', 'dither', 'shader background', '漫游', '像素画', '像素画背景', '抖动背景', '网点背景', '主题色背景'],
    },
    /*
     * 上游的 `renderSettingsPanel` / `renderQuickControls` / `resetSettings` 未搬：它们依赖上游的
     * `VisualizerTuningSettings` store 与 `QuickControlChip`。本项目的背景设置直接读 `settingsStore`
     * （`FoliaBackgroundSettings.tsx`），没有这条注册通路。
     */
    // The shader draws one image and cannot blend to another, so a new song's image comes as a new copy.
    song: ({ config, coverUrl }) => [
        resolveNomandSourceUrl(
            coverUrl,
            config?.customImage,
            { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...config?.nomand?.tuning },
        ) ?? null,
    ],
    render: ({ config, coverUrl, theme, isDaylight }) => (
        <NomandBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            tuning={config?.nomand?.tuning}
            theme={theme}
            isDaylight={isDaylight}
        />
    ),
});

export default nomandBackgroundEntry;
