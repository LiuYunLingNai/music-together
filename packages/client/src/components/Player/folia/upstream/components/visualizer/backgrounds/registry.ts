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

/**
 * 上游按 order 排好的背景条目列表（设置窗口的画廊按这个顺序铺）。
 *
 * ★ 必须是**函数**而不是模块级常量：上游用 `import.meta.glob(..., { eager: true })` 在
 *   注册表模块初始化时就建好了列表；本项目改为 `entries.ts` 显式注册，注册发生在
 *   列表求值之后 —— 常量会永远是空数组（窗口的「背景类型」画廊因此什么都不显示）。
 *   每次读取时按当前注册表重算，六个条目的开销可以忽略。
 */
export const getVisualizerBackgroundRegistry = (): VisualizerBackgroundRegistryEntry[] =>
    BUILTIN_VISUALIZER_BACKGROUND_MODES
        .map((mode) => VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode])
        .filter((entry): entry is VisualizerBackgroundRegistryEntry => Boolean(entry))
        .sort((left, right) => left.order - right.order);

/** 背景名：优先 i18n，取不到时用条目的 labelFallback（与上游同一判据）。 */
export const getVisualizerBackgroundModeLabel = (
    mode: VisualizerBackgroundMode,
    t: (key: string) => string,
) => {
    const entry = getVisualizerBackgroundRegistryEntry(mode);
    const translated = t(entry.labelKey);
    return !translated || translated === entry.labelKey ? entry.labelFallback : translated;
};

export const hasVisualizerBackgroundMode = (mode: unknown): mode is VisualizerBackgroundMode =>
    typeof mode === 'string' && Boolean(VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode]);
