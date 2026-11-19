import { defineVisualizerTuning } from '../tuningDefinition';
import { DEFAULT_KINETIC_TUNING, normalizeKineticTuning, type KineticTuning } from './kineticSettings';
export type { KineticTuning } from './kineticSettings';

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings {
        kineticTuning: KineticTuning;
        handleSetKineticTuning: (patch: Partial<KineticTuning>) => void;
        handleResetKineticTuning: () => void;
    }
}

export default defineVisualizerTuning<KineticTuning>({
    mode: 'kinetic',
    defaults: DEFAULT_KINETIC_TUNING,
    apply: (props, tuning) => ({ ...props, kineticTuning: tuning }),
    preview: (draft) => ({ ...draft, previewDraft: true }),
    settingsKey: 'kineticTuning',
    settingsSetterKey: 'handleSetKineticTuning',
    settingsResetterKey: 'handleResetKineticTuning',
    storage: {
        key: 'kinetic_tuning',
        read: normalizeKineticTuning,
        merge: (held, patch) => normalizeKineticTuning({ ...held, ...patch }),
        resetNotice: 'notifications.kineticReset',
    },
});
