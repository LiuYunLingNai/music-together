import UrlBackgroundLayer from './UrlBackgroundLayer';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/url/entry.tsx
// Registers the embedded webpage shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const urlBackgroundEntry = defineVisualizerBackground({
    mode: 'url',
    order: 40,
    labelKey: 'options.visualizerBackgroundModeUrl',
    labelFallback: 'Embed',
    // 嵌入：网页框
    glyph: (
        <>
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <path d="M3.5 9.5h17" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Background: Embedded Background',
        description: 'Switch background to embedded webpage mode',
        keywords: ['embedded background', 'embed background', 'background embed', 'background url', 'url background', 'url', 'webpage', '嵌入背景', '网页背景', '背景切换到 嵌入背景', '背景切换到嵌入背景'],
    },
    /*
     * 上游的 `renderSettingsPanel` 未搬：它依赖上游的 `VisualizerTuningSettings` store 与
     * `QuickControlChip`。本项目的背景设置直接读 `settingsStore`（`FoliaBackgroundSettings.tsx`），
     * 没有这条注册通路。
     */
    render: ({ config }) => (
        <UrlBackgroundLayer
            urlBackgroundList={config?.url?.items}
            urlBackgroundSelectedId={config?.url?.selectedId}
        />
    ),
});

export default urlBackgroundEntry;
