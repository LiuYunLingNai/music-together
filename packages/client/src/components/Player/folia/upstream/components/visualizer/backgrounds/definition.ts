import React from 'react';
import type { MotionValue } from 'motion/react';
import type {
    AudioBands,
    LatentBackgroundTuning,
    MonetBackgroundImage,
    MonetBackgroundTuning,
    NomandBackgroundTuning,
    SoraBackgroundTuning,
    Theme,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
} from '../../../types';
import type { VisualizerModeCommand } from '../definition';

// src/components/visualizer/backgrounds/definition.ts
// Shared contracts for discoverable visualizer background modes.

/** A background's tuning as the background config carries it, under the background's id. */
export interface BackgroundTuningSlot<T> {
    tuning?: T;
}

/** The actions of a background's tuning as the background actions carry them, under the background's id. */
export interface BackgroundTuningActionSlot<T> {
    onTuningChange?: (patch: Partial<T>) => void;
    onResetTuning?: () => void;
}

export interface VisualizerBackgroundConfig {
    mode?: VisualizerBackgroundMode | null;
    transparent?: boolean;
    common?: {
        useCoverColorBg?: boolean;
        opacity?: number;
        disableGeometricBackground?: boolean;
        disableVignette?: boolean;
    };
    customImage?: MonetBackgroundImage | null;
    /*
     * 上游把每个背景的调参写在 `BackgroundTuningSlot<T>` 里，由各背景的 `tuning.ts` 用
     * `declare module` 补上成员；本项目没有那套 settings store（背景调参直接存在
     * `settingsStore.foliaSettings.backgroundConfig`），因此这里把四个成员写死，形状与
     * 上游的 slot 完全一致。
     */
    monet?: {
        tuning?: MonetBackgroundTuning;
    };
    nomand?: {
        tuning?: NomandBackgroundTuning;
    };
    latent?: {
        tuning?: LatentBackgroundTuning;
    };
    sora?: {
        tuning?: SoraBackgroundTuning;
    };
    url?: {
        items?: UrlBackgroundItem[];
        selectedId?: string | null;
    };
}

export interface VisualizerBackgroundActions {
    onModeChange?: (mode: VisualizerBackgroundMode) => void;
    common?: {
        onCoverColorChange?: (enabled: boolean) => void;
        onOpacityChange?: (opacity: number) => void;
        onDisableGeometricChange?: (disabled: boolean) => void;
        onDisableVignetteChange?: (disabled: boolean) => void;
    };
    customImage?: {
        onUpload?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
        onClear?: () => Promise<void> | void;
        isLoading?: boolean;
    };
    monet?: {
        onTuningChange?: (patch: Partial<MonetBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    nomand?: {
        onTuningChange?: (patch: Partial<NomandBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    latent?: {
        onTuningChange?: (patch: Partial<LatentBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    sora?: {
        onTuningChange?: (patch: Partial<SoraBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    url?: {
        onAdd?: (item: UrlBackgroundItem) => void;
        onUpdate?: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
        onDelete?: (id: string) => void;
        onSelect?: (id: string | null) => void;
    };
}

export interface VisualizerBackgroundRenderProps {
    config?: VisualizerBackgroundConfig;
    theme: Theme;
    /** 见 `definition.ts` 的说明：本项目只有深色主题，恒为 `false`。 */
    isDaylight: boolean;
    coverUrl?: string | null;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    seed?: string | number;
    staticMode: boolean;
    paused: boolean;
    /**
     * 就地换色的背景（entry 没有 `song`）用多久过渡到新颜色（`useBlendedColors`）：
     * 上游给的是柔焦过渡的长度（`transition.enter.delay + duration`），不播放过渡时为 0。
     */
    blendMs?: number;
    /** Where given, that blend plays along this (0..1, a blend's song hand-off) instead of over blendMs. */
    blendProgress?: MotionValue<number>;
}

export interface VisualizerBackgroundSettingsProps {
    config?: VisualizerBackgroundConfig;
    actions?: VisualizerBackgroundActions;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

/** 播放面板背景行里该模式专属的快捷参数，只放一到两个最常调的项。 */
export interface VisualizerBackgroundQuickControlsProps {
    config?: VisualizerBackgroundConfig;
    actions?: VisualizerBackgroundActions;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
}

export interface VisualizerBackgroundRegistryEntry {
    mode: VisualizerBackgroundMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    /*
     * The small line icon shown beside the background's name: the children of the 24x24 stroked
     * <svg> that modeGlyphs.tsx draws. A background without one (a mod's, say) gets the generic icon.
     */
    glyph?: React.ReactNode;
    /** The command that switches to this background (id `background-<mode>`). A background without one has no plain switch command. */
    command?: VisualizerModeCommand;
    /*
     * 这个背景随歌曲改变的输入（封面、布局种子）。这些值一变，整个背景就换一份：
     * 新的副本挂上来（过渡层播放柔焦），旧副本留在下面画旧的歌。
     * 不带这一个成员的背景不随歌换，就地重绘。
     */
    song?: (props: VisualizerBackgroundRenderProps) => readonly unknown[];
    render: (props: VisualizerBackgroundRenderProps) => React.ReactNode;
    renderSettingsPanel?: (props: VisualizerBackgroundSettingsProps) => React.ReactNode;
    renderQuickControls?: (props: VisualizerBackgroundQuickControlsProps) => React.ReactNode;
    resetSettings?: (actions?: VisualizerBackgroundActions) => void;
}

export interface VisualizerBackgroundEntryModule {
    default: VisualizerBackgroundRegistryEntry;
}

export const defineVisualizerBackground = (entry: VisualizerBackgroundRegistryEntry) => entry;
