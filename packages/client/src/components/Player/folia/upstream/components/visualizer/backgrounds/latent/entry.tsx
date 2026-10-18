import LatentBackground from './LatentBackground';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/latent/entry.tsx
// Registers the cover-colored, audio-reactive Latent shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const latentBackgroundEntry = defineVisualizerBackground({
    mode: 'latent',
    order: 35,
    labelKey: 'options.visualizerBackgroundModeLatent',
    labelFallback: 'Latent',
    // 隐现：上层像素点阵，下层流体
    glyph: (
        <>
            <path d="M4.5 7.5h.01M9 7.5h.01M13.5 7.5h.01M18 7.5h.01" strokeWidth="2.2" opacity="0.55" />
            <path d="M3 15c3-3.5 6-3.5 9 0s6 3.5 9 0" />
        </>
    ),
    command: {
        title: 'Background: Latent',
        description: 'Switch background to cover-colored audio-reactive shaders',
        keywords: ['latent', 'latent background', 'shader background', '隐现', '隐现背景', '音频响应背景'],
    },
    /*
     * 上游的 `renderSettingsPanel` / `renderQuickControls` / `resetSettings` 未搬：它们依赖上游的
     * `VisualizerTuningSettings` store 与 `QuickControlChip`。本项目的背景设置直接读 `settingsStore`
     * （`FoliaBackgroundSettings.tsx`），没有这条注册通路。
     */
    // No `song`: a new song's cover colours blend in place (blendMs).
    render: ({ config, theme, coverUrl, audioPower, audioBands, staticMode, paused, blendMs }) => (
        <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            staticMode={staticMode}
            paused={paused}
            tuning={config?.latent?.tuning}
            blendMs={blendMs}
        />
    ),
});

export default latentBackgroundEntry;
