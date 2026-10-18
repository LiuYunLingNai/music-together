import SoraBackground from './SoraBackground';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/sora/entry.tsx
// Registers the shader-based Sora starfield shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const soraBackgroundEntry = defineVisualizerBackground({
    mode: 'sora',
    order: 50,
    labelKey: 'options.visualizerBackgroundModeSora',
    labelFallback: 'Sora',
    // 空：稀疏星点
    glyph: (
        <>
            <path d="M12 5.5l1.2 2.9 2.9 1.2-2.9 1.2L12 13.7l-1.2-2.9-2.9-1.2 2.9-1.2z" />
            <path d="M5.5 16.5h.01M18 15.5h.01M7 7h.01" strokeWidth="2.2" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Background: Sora',
        description: 'Switch background to Sora (starry sky) layout',
        keywords: ['sora', 'starry sky', 'star', '星空', '空', '背景切换到 空', '背景切换到空', '背景切换到Sora', '背景切换到星空'],
    },
    /*
     * 上游的 `renderSettingsPanel` / `renderQuickControls` / `resetSettings` 未搬：它们依赖上游的
     * `VisualizerTuningSettings` store 与 `QuickControlChip`。本项目的背景设置直接读 `settingsStore`
     * （`FoliaBackgroundSettings.tsx`），没有这条注册通路。
     */
    // No `song`: the stars draw the theme colours only, and blend to new ones in place (blendMs).
    // Blank mode never mounts the WebGL canvas: just a static black (night) / white (daylight) frame.
    // Static mode intentionally freezes the starfield, matching the shared background contract.
    render: ({ config, theme, isDaylight, paused, staticMode, blendMs, blendProgress }) => (
        <div className="absolute inset-0 z-0" style={{ backgroundColor: isDaylight ? '#ffffff' : '#000000' }}>
            {!config?.sora?.tuning?.blank && (
                <SoraBackground theme={theme} isDaylight={isDaylight} paused={paused || staticMode} blendMs={blendMs} blendProgress={blendProgress} />
            )}
        </div>
    ),
});

export default soraBackgroundEntry;
