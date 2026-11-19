import { useSettingsStore } from '@/stores/settingsStore';
import { getPlaybackSongKey, usePlaybackStore } from '../../../adapters/kineticPlayback';
import { kineticLrc, makeKineticSongProject, normalizeKineticTuning, resolveKineticScopedTuning, type KineticTuning } from './kineticSettings';
import { readKineticProject, writeKineticProject } from './kineticProjectMemory';

const globalTuning = () => normalizeKineticTuning(useSettingsStore.getState().foliaSettings.tunings.kinetic);
const songIdentity = () => {
    const player = usePlaybackStore.getState();
    return { songKey: getPlaybackSongKey(player.currentSong), source: kineticLrc(player.lyrics?.lines ?? []) };
};
const writeGlobal = (value: KineticTuning) => {
    const settings = useSettingsStore.getState().foliaSettings;
    useSettingsStore.getState().setFoliaSettings({ tunings: { ...settings.tunings, kinetic: value } });
};

/** Each save closure belongs to the scope/song for which a slider draft was created. */
export function kineticScopedSettings() {
    const global = globalTuning();
    const identity = songIdentity();
    const saved = readKineticProject(identity.songKey);
    const tuning = resolveKineticScopedTuning(global, saved);
    const stillCurrent = () => {
        const current = songIdentity();
        return current.songKey === identity.songKey && current.source === identity.source;
    };
    return {
        kineticTuning: tuning,
        handleSetKineticTuning: (patch: Partial<KineticTuning>) => {
            if (patch.scope !== undefined) {
                if (patch.scope === 'global' || patch.scope === 'song') writeGlobal({ ...globalTuning(), scope: patch.scope });
                return;
            }
            if (globalTuning().scope !== global.scope) return;
            if (global.scope === 'global') {
                writeGlobal(normalizeKineticTuning({ ...globalTuning(), ...patch }));
                return;
            }
            if (!identity.songKey || !identity.source || !stillCurrent()) return;
            const latest = readKineticProject(identity.songKey);
            const next = normalizeKineticTuning({ ...resolveKineticScopedTuning(globalTuning(), latest), ...patch, scope: 'song' });
            writeKineticProject(identity.songKey, makeKineticSongProject(next, identity.source, latest));
        },
        handleResetKineticTuning: () => {
            if (globalTuning().scope !== global.scope) return;
            if (global.scope === 'song') {
                if (stillCurrent()) writeKineticProject(identity.songKey, null);
            } else {
                writeGlobal(normalizeKineticTuning({ scope: 'global' }));
            }
        },
    };
}
