import React from 'react';
import { type MotionValue } from 'motion/react';
import {
    type AudioBands,
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type HanabiTuning,
    type CadenzaTuning,
    type ClassicTuning,
    type CladdaghTuning,
    type DioramaTuning,
    type FumeTuning,
    type Line,
    type LumiereTuning,
    type MonetPortraitImage,
    type MonetTuning,
    type PartitaTuning,
    type PendoloTuning,
    type SonnetTuning,
    type SubtitleContentMode,
    type TemperaTuning,
    type Theme,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';

import type { VisualizerBackgroundConfig } from './backgrounds/definition';

// src/components/visualizer/definition.ts
// Shared contracts for discoverable visualizer modes.
export type VisualizerTuningKind = 'none' | 'classic' | 'cadenza' | 'partita' | 'fume' | 'claddagh' | 'cappella' | 'tilt' | 'monet' | 'diorama' | 'pendolo' | 'sonnet' | 'tempera' | 'lumiere' | 'hanabi';

/** The command-palette line that switches to a lyric style or a background. The command list builds its id from the mode. */
export interface VisualizerModeCommand {
    title: string;
    description: string;
    keywords: string[];
}

/**
 * An automix/crossfade blend handing the picture from the song on screen to the next one. The main
 * window only, and only for a style that says it draws one (`followsSongHandoff`): everywhere else
 * the song changes when the blend has settled, as it did.
 */
export interface VisualizerSongHandoff {
    /** How far the hand-off has come, 0..1: 0 until the blend is announced. */
    progress: MotionValue<number>;
    /** The incoming song as the props will name it once the blend settles. */
    seed: string | number;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /** The incoming song's theme, once it has come: the props keep the song on screen's until the blend settles. */
    theme: Theme;
    subtitleTheme?: Theme;
    /** The incoming song's lyrics (none until they load), its own lyric clock and line. */
    lines: Line[];
    currentTime: MotionValue<number>;
    currentLineIndex: number;
}

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    /** The song's length in seconds, 0 or absent while unknown; in a preview, the preview's length. Mod styles read it (getDuration). */
    duration?: number;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    /**
     * 上游的日夜模式标志。本项目只有深色主题（见 `useFoliaTheme`），从不传入，恒为 `false`：
     * 上游按它分叉的地方（still 的暗角、monet 的 `baseImageOpacity`、nomand 的反色、
     * sora 的底色）在这里都走深色那一支。保留字段是为了把各模式按上游原样搬过来。
     */
    isDaylight?: boolean;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /**
     * Tempera canvas images shipped inline by the OBS overlay. That page is a separate browsing
     * context with no access to the app's IndexedDB, so when this is present the visualizer uses
     * it instead of reading the pool from storage.
     */
    temperaLayerImageAssets?: { id: string; name: string; url: string }[];
    seed?: string | number;
    /** A blend handing over to the next song, while it runs (see VisualizerSongHandoff). */
    songHandoff?: VisualizerSongHandoff | null;
    staticMode?: boolean;
    backgroundStaticMode?: boolean;
    visualizerOpacity?: number;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleFontScale?: number;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    paused?: boolean;
    onBack?: () => void;
    isPanelOpen?: boolean;
    alwaysShowBackButton?: boolean;
    onPlayerPanelGuideHotspotChange?: (isActive: boolean) => void;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    isPreviewMode?: boolean;
    /** 上游窗口把整包调参挂在 props 上，各模式自己取自己那一份（宿主渲染器不读）。 */
    visualizerTunings?: Record<string, unknown>;
    /** 画面里直接拖动调参时由渲染器回传（宿主不实现拖拽调参，保留契约）。 */
    onVisualizerTuningChange?: (patch: object) => void;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    dioramaTuning?: DioramaTuning;
    monetTuning?: MonetTuning;
    monetPortraitImage?: MonetPortraitImage | null;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    pendoloTuning?: PendoloTuning;
    onPendoloTuningChange?: (patch: Partial<PendoloTuning>) => void;
    sonnetTuning?: SonnetTuning;
    onSonnetTuningChange?: (patch: Partial<SonnetTuning>) => void;
    temperaTuning?: TemperaTuning;
    onTemperaTuningChange?: (patch: Partial<TemperaTuning>) => void;
    lumiereTuning?: LumiereTuning;
    onLumiereTuningChange?: (patch: Partial<LumiereTuning>) => void;
    hanabiTuning?: HanabiTuning;
    onHanabiTuningChange?: (patch: Partial<HanabiTuning>) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 上游以泛型标注各模式调参，这里保留同一契约。
export interface VisualizerSettingsPanelProps<T = any> {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    classicTuning?: ClassicTuning;
    onClassicTuningChange?: (patch: Partial<ClassicTuning>) => void;
    partitaTuning?: PartitaTuning;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    fumeTuning?: FumeTuning;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    claddaghTuning?: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    onCappellaTuningChange?: (patch: Partial<CappellaTuning>) => void;
    cappellaCustomEmojiCount?: number;
    hasCappellaCustomEmojiPack?: boolean;
    isCappellaCustomEmojiPackLoading?: boolean;
    onImportCappellaCustomEmojiPack?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack?: () => Promise<void> | void;
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    onImportCappellaCustomAvatar?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomAvatar?: () => Promise<void> | void;
    hasCappellaCustomAvatar?: boolean;
    isCappellaCustomAvatarLoading?: boolean;
    tiltTuning?: TiltTuning;
    onTiltTuningChange?: (patch: Partial<TiltTuning>) => void;
    dioramaTuning?: DioramaTuning;
    onDioramaTuningChange?: (patch: Partial<DioramaTuning>) => void;
    monetTuning?: MonetTuning;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    monetPortraitImage?: MonetPortraitImage | null;
    onUploadMonetPortraitImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetPortraitImage?: () => Promise<void> | void;
    isLoadingMonetPortraitImage?: boolean;
    pendoloTuning?: PendoloTuning;
    onPendoloTuningChange?: (patch: Partial<PendoloTuning>) => void;
    sonnetTuning?: SonnetTuning;
    onSonnetTuningChange?: (patch: Partial<SonnetTuning>) => void;
    temperaTuning?: TemperaTuning;
    onTemperaTuningChange?: (patch: Partial<TemperaTuning>) => void;
    lumiereTuning?: LumiereTuning;
    onLumiereTuningChange?: (patch: Partial<LumiereTuning>) => void;
    hanabiTuning?: HanabiTuning;
    onHanabiTuningChange?: (patch: Partial<HanabiTuning>) => void;
    /** The style's tuning as the window shows it. */
    tuning?: T;
    /** A change to the tuning. */
    onTuningChange?: (patch: Partial<T>) => void;
    /** 上游面板从 settings 里取这个模式的附加动作（上传的图、清空等）。 */
    settings?: Record<string, unknown>;
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
}

export interface VisualizerSettingsResetProps {
    resetClassicTuning?: () => void;
    resetPartitaTuning?: () => void;
    resetFumeTuning?: () => void;
    resetCladdaghTuning?: () => void;
    resetCappellaTuning?: () => void;
    resetTiltTuning?: () => void;
    resetDioramaTuning?: () => void;
    resetMonetTuning?: () => void;
    resetPendoloTuning?: () => void;
    resetSonnetTuning?: () => void;
    resetTemperaTuning?: () => void;
    resetLumiereTuning?: () => void;
    setDraftFumeTuning?: (tuning: FumeTuning) => void;
    setDraftCladdaghTuning?: (tuning: CladdaghTuning) => void;
    setDraftPendoloTuning?: (tuning: PendoloTuning) => void;
    setDraftSonnetTuning?: (tuning: SonnetTuning) => void;
    setDraftTemperaTuning?: (tuning: TemperaTuning) => void;
    setDraftLumiereTuning?: (tuning: LumiereTuning) => void;
}

export interface VisualizerRegistryEntry {
    mode: VisualizerMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    previewSeed: string;
    previewStartOffset: number;
    /*
     * The small line icon shown beside the style's name: the children of the 24x24 stroked <svg>
     * that modeGlyphs.tsx draws. A style without one (a mod's, say) gets the generic icon.
     */
    glyph?: React.ReactNode;
    /** The command that switches to this style (id `visualizer-<mode>`). A style without one has no command. */
    command?: VisualizerModeCommand;
    /** True when the renderer reads a click on a lyric line and the song should jump there. */
    seeksOnLineClick?: boolean;
    /** True when the renderer draws a blend's song hand-off (`songHandoff`); the rest are not fed one. */
    followsSongHandoff?: boolean;
    /*
     * The background this style is drawn over. VisualizerRenderer draws one background for every
     * style and keeps it through a style switch, so a style that changes it says so here, not only
     * in its own shell: false for none at all (Still), or the config to draw it with (Fume hides the
     * geometric shapes). Left out: the background in the props, as it is.
     *
     * ★ 本项目：各模式的 entry 没有搬（见 `FoliaRenderer` 的 `MODE_BACKGROUNDS`），宿主在那里
     *   按模式给出同一份映射；字段保留是为了契约完整。
     */
    background?: false | ((props: VisualizerSharedProps) => VisualizerBackgroundConfig | undefined);
    tuningKind: VisualizerTuningKind;
    /*
     * 各模式的 entry.tsx 把真正的 renderer 包成 React.lazy —— registry 用 eager glob 发现
     * entry，如果 entry 静态 import renderer，任何碰 visualizer 设置的模块都会连带拉进 13 个
     * renderer（183 个模块，含 three.js，而 three 只有 diorama 用）。契约不变：这里仍然是
     * props => ReactElement，lazy 组件照样满足。代价是调用方必须提供 Suspense 边界。
     */
    render: (props: VisualizerSharedProps) => React.ReactElement;
    renderSettingsPanel?: (props: VisualizerSettingsPanelProps) => React.ReactNode;
    /*
     * 上游这里还有 `renderQuickControls`（播放面板里的快捷参数）。它的 props 依赖上游的
     * `VisualizerTuningSettings`（settings store 的字段表，由各 `tuning.ts` 用 `declare module`
     * 拼出来）——本项目没有那套 store，调参由 `stage/foliaTunings.ts` 解析后以 props 传入，
     * 因此不搬这一个字段。
     */
    /** For a style that sizes its own lyrics: the notice (an i18n key) the settings window shows where it switches the font size off. */
    ownFontSizeNoticeKey?: string;
    resetSettings?: (props: VisualizerSettingsResetProps) => void;
    /*
     * True when this mode's layout atoms come from whole-line word segmentation
     * (utils/lyrics/wordSegmentation), so the user's saved split for a song changes what it draws.
     * Declared here rather than as a list in the panel: the panel and the command both ask the
     * registry, so adding a mode does not mean remembering to edit a hardcoded set.
     * Grapheme-level modes leave it unset — a word split would not affect them.
     */
    usesWordSegmentation?: boolean;
    /*
     * Folium tunables: the multiplier keys this mode reads through
     * useFoliumTunings(mode), with the range a mod may set and the identity
     * value (the unmodified look). Declaring a key makes its name public API —
     * mods address it by name, so renaming it is a breaking Folium change.
     * Modes without this field cannot be targeted by `registries.tunings`.
     */
    foliumTunables?: Readonly<Record<string, FoliumTunable>>;
}

export interface FoliumTunable {
    min: number;
    max: number;
    identity: number;
}

export interface VisualizerEntryModule {
    default: VisualizerRegistryEntry;
}

export const defineVisualizer = (entry: VisualizerRegistryEntry) => entry;
