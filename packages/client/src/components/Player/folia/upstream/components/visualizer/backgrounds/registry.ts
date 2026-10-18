import type { VisualizerBackgroundMode } from '../../../types';
import type { VisualizerBackgroundRegistryEntry } from './definition';

// src/components/visualizer/backgrounds/registry.tsx
// 上游用 `import.meta.glob('./*/entry.tsx', { eager: true })` 发现背景。
// 本项目不走 entry 机制（entry 里只有注册元数据，渲染实现就在各目录下），
// 因此这里静态列出——顺序与上游 entry 的 `order` 一致：
// common 10 / monet 20 / nomand 30 / latent 35 / url 40 / sora 50。

export const DEFAULT_VISUALIZER_BACKGROUND_MODE: VisualizerBackgroundMode = 'latent';

export const BUILTIN_VISUALIZER_BACKGROUND_MODES = [
    'common',
    'monet',
    'nomand',
    'latent',
    'url',
    'sora',
] as const;

const VISUALIZER_BACKGROUND_REGISTRY_BY_MODE: Partial<Record<string, VisualizerBackgroundRegistryEntry>> = {};

export const defineVisualizerBackground = (entry: VisualizerBackgroundRegistryEntry) => entry;

export const registerVisualizerBackground = (entry: VisualizerBackgroundRegistryEntry): boolean => {
    if (VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[entry.mode]) return false;
    VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[entry.mode] = entry;
    return true;
};

export const getVisualizerBackgroundRegistryEntry = (mode: VisualizerBackgroundMode) => (
    VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode]
    ?? VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[DEFAULT_VISUALIZER_BACKGROUND_MODE]!
);
