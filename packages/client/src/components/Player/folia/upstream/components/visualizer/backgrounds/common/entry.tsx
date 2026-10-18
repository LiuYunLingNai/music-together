import { defineVisualizerBackground } from '../definition';
import FluidBackground from './FluidBackground';
import GeometricBackground from './GeometricBackground';

// src/components/visualizer/backgrounds/common/entry.tsx
// Registers the built-in cover-color and geometric shell background.

// 具名再导出：react-refresh 不接受匿名组件作为默认导出。
const commonBackgroundEntry = defineVisualizerBackground({
    mode: 'common',
    order: 10,
    labelKey: 'options.visualizerBackgroundModeCommon',
    labelFallback: 'Common',
    // 通用：几何图形氛围层
    glyph: (
        <>
            <path d="M4 17l5-8 5 8z" />
            <circle cx="17.5" cy="8.5" r="3" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Background: Common',
        description: 'Switch background to general layout',
        keywords: ['background general', 'common', 'general', '通用背景', 'ty', '背景切换到 通用', '背景切换到通用'],
    },
    /*
     * 上游的 `renderSettingsPanel` / `renderQuickControls` / `resetSettings` 未搬：它们依赖上游的
     * `VisualizerTuningSettings` store 与 `QuickControlChip`。本项目的背景设置直接读 `settingsStore`
     * （`FoliaBackgroundSettings.tsx`），没有这条注册通路。
     */
    // The geometry is laid out from the seed, and the cover colour layer draws the cover. The theme
    // colours change in place: the base colour glides, as it did.
    song: ({ config, coverUrl, seed, staticMode }) => [
        staticMode ? null : seed ?? null,
        config?.common?.useCoverColorBg ? coverUrl ?? null : null,
    ],
    render: ({
        config,
        theme,
        coverUrl,
        audioPower,
        audioBands,
        seed,
        staticMode,
        paused,
    }) => {
        const common = config?.common;
        const useCoverColorBg = common?.useCoverColorBg ?? false;

        return (
            <>
                {/* Shown at once: turning the cover colours on or off is a change of `song`, played by the
                    background layer around it. */}
                {useCoverColorBg && (
                    <div className="absolute inset-0 z-0">
                        <FluidBackground coverUrl={coverUrl} theme={theme} />
                    </div>
                )}
                <div
                    className="absolute inset-0 z-0 transition-all duration-1000"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: useCoverColorBg ? common?.opacity ?? 0.75 : 1,
                    }}
                />
                {!staticMode && (
                    <div className="absolute inset-0 z-0">
                        <GeometricBackground
                            theme={theme}
                            audioPower={audioPower}
                            audioBands={audioBands}
                            seed={seed}
                            hideShapes={common?.disableGeometricBackground ?? false}
                            disableVignette={common?.disableVignette ?? false}
                            paused={paused}
                        />
                    </div>
                )}
            </>
        );
    },
});

export default commonBackgroundEntry;
