import type {
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    CladdaghTuning,
    DioramaTuning,
    FumeTuning,
    LumiereTuning,
    MonetTuning,
    PartitaTuning,
    PendoloTuning,
    SonnetTuning,
    TemperaTuning,
    TiltTuning,
    VisualizerMode,
} from '../../types';
import type { VisualizerSharedProps } from './definition';
import type { BackgroundSettingsSlice, BackgroundTuningDefinition, StoredTuning, StoredTuningAdapter, VisualizerTuningAdapter } from './tuningDefinition';

// src/components/visualizer/tuningRegistry.ts
// Pure-data registry for transporting heterogeneous visualizer tuning without importing renderers.

// The types of the 13 styles that existed before a tuning.ts stated its own. A new style adds no
// line here: its tuning.ts carries the type, and its entry takes the tuning with read().
export interface VisualizerTuningMap {
    classic: ClassicTuning;
    cadenza: CadenzaTuning;
    partita: PartitaTuning;
    fume: FumeTuning;
    claddagh: CladdaghTuning;
    cappella: CappellaTuning;
    tilt: TiltTuning;
    diorama: DioramaTuning;
    monet: MonetTuning;
    pendolo: PendoloTuning;
    sonnet: SonnetTuning;
    tempera: TemperaTuning;
    lumiere: LumiereTuning;
}

export type VisualizerTuningBundle = Partial<VisualizerTuningMap>;

/**
 * 上游用 glob 扫描各模式的 tuning.ts 收集调参适配器；宿主没有那套文件，
 * 调参由 `lib/foliaTuningSchema.ts` 的声明式表和 `stage/foliaTunings.ts` 解析。
 * 这里给出同形状的适配器：`settingsKey` 等字段只为窗口的草稿机制服务，
 * `apply` 把调参挂到渲染器读的那个 prop 上（宿主 `FoliaModeId` 与上游 id 的映射同 windowRegistry）。
 */
const TUNING_MODES = ['classic', 'cadenza', 'partita', 'fume', 'claddagh', 'cappella', 'tilt', 'monet', 'pendolo', 'sonnet', 'tempera', 'lumiere', 'hanabi', 'diorama'] as const;

const propName = (mode: string) => (mode === 'classic' ? 'classicTuning' : `${mode}Tuning`);

const adapters: VisualizerTuningAdapter[] = TUNING_MODES.map(mode => ({
    mode,
    defaults: {} as never,
    settingsKey: `${mode}Tuning`,
    settingsSetterKey: `handleSet${mode[0].toUpperCase()}${mode.slice(1)}Tuning`,
    settingsResetterKey: `handleReset${mode[0].toUpperCase()}${mode.slice(1)}Tuning`,
    apply: (props, tuning) => ({ ...props, [propName(mode)]: tuning }) as VisualizerSharedProps,
    read: (bundle) => (bundle as Record<string, unknown> | undefined)?.[mode] ?? ({} as never),
    /**
     * 上游 tuning.ts 的 `storage`：窗口的草稿机制靠它判断「这个调参能不能改」，
     * 并靠 `merge` 把一次改动叠到当前值上。宿主没有 localStorage 键
     * （调参存在 `foliaSettings.tunings` 里，由 settingsStore 持久化），
     * 所以这里只提供 `merge`；缺了它 `styleDraftTarget()` 返回 null，
     * 窗口里所有滑块都会变成只读（这正是早期版本参数全都调不动的根因）。
     */
    storage: {
        key: `folia.tuning.${mode}`,
        read: (stored: unknown) => (stored && typeof stored === 'object' ? stored : {}) as never,
        merge: (held: unknown, patch: unknown) => ({ ...(held as object), ...(patch as object) }) as never,
    },
}));
const adaptersByMode = new Map<string, VisualizerTuningAdapter>(adapters.map(adapter => [adapter.mode, adapter]));

export const getVisualizerTuningModes = (): string[] => [...adaptersByMode.keys()];

/**
 * 把调参并入渲染器的 props（上游同签名）：`bundle` 是该模式的调参包，
 * 命中的适配器把调参挂到渲染器读的那个 prop 上；没有适配器时原样返回。
 */
export const applyVisualizerTuning = (
    mode: VisualizerMode,
    props: VisualizerSharedProps,
    bundle?: VisualizerTuningBundle,
): VisualizerSharedProps => {
    const adapter = adaptersByMode.get(mode);
    const tuning = (bundle as Record<string, unknown> | undefined)?.[mode];
    return adapter?.apply && tuning ? adapter.apply(props, tuning) : props;
};

/** The tuning a lyric style declared; none for a style without settings of its own (a mod's style keeps its own elsewhere). */
export const getVisualizerTuning = (mode: string): VisualizerTuningAdapter | undefined => adaptersByMode.get(mode);

// The backgrounds' tunings are stored the same way, but ride no bundle: a background reads its own from the background config.
// 宿主的背景调参存在 `foliaSettings.backgroundConfig` 里，没有上游那套 tuning.ts。
const backgroundTunings: BackgroundTuningDefinition[] = [];

/** The tunings the backgrounds declared, each under its background's id. */
export const getBackgroundTunings = (): readonly BackgroundTuningDefinition[] => backgroundTunings;

/**
 * The backgrounds' tunings as a background config carries them: under each background's id, as
 * `{ tuning }`. `settings` holds them under the store's field names (the settings store, or a
 * copy of its fields such as the OBS page receives).
 */
export const backgroundTuningConfig = (settings: Record<string, unknown>): Record<string, { tuning: unknown }> => Object.fromEntries(
    backgroundTunings.map(tuning => [tuning.mode, { tuning: settings[tuning.settingsKey] }]),
);

/** The actions that change and reset the backgrounds' tunings, as the background actions carry them: under each background's id. */
export const backgroundTuningActions = (settings: Record<string, unknown>): Record<string, { onTuningChange: unknown; onResetTuning: unknown }> => Object.fromEntries(
    backgroundTunings.map(tuning => [tuning.mode, {
        onTuningChange: settings[tuning.settingsSetterKey],
        onResetTuning: settings[tuning.settingsResetterKey],
    }]),
);

const backgroundSettingsModules: Record<string, { default: BackgroundSettingsSlice }> = {};

/** The backgrounds' stored settings that are no tuning object: each builds its own store fields. */
export const getBackgroundSettingsSlices = (): BackgroundSettingsSlice[] => (
    Object.values(backgroundSettingsModules).map(module => module.default)
);

/** The tunings that declare where they are stored, the styles' and the backgrounds': the settings store builds its fields and actions from these. */
export const getStoredVisualizerTunings = (): StoredTuning[] => [
    ...adapters.filter((adapter): adapter is StoredTuningAdapter => Boolean(adapter.storage && adapter.settingsResetterKey)),
    ...backgroundTunings,
];

export const collectVisualizerTunings = (settings: Record<string, unknown>): VisualizerTuningBundle => {
    const bundle: VisualizerTuningBundle = {};
    adapters.forEach(adapter => {
        const value = settings[adapter.settingsKey];
        if (value !== undefined) {
            (bundle as Record<string, unknown>)[adapter.mode] = value;
        }
    });
    return bundle;
};

export const applyVisualizerTuningsToSettings = (
    settings: Record<string, unknown>,
    bundle: VisualizerTuningBundle,
) => {
    adapters.forEach(adapter => {
        const value = (bundle as Record<string, unknown>)[adapter.mode];
        const setter = settings[adapter.settingsSetterKey];
        if (value !== undefined && typeof setter === 'function') {
            setter(value);
        }
    });
};
