// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { normalizeKineticTuning } from './kineticSettings';
import { readKineticProject, writeKineticProject } from './kineticProjectMemory';
import { kineticScopedSettings } from './kineticScopedSettings';
import { useVisualizerSettingsStore } from '../../../adapters/hostStores';
import { useTuningDrafts } from '../window/useTuningDrafts';

const track = { id: 'queue-a', title: 'Alpha', artist: [], album: '', cover: '', duration: 100, source: 'netease' as const, sourceId: '1', urlId: '1' };
const settings = () => normalizeKineticTuning(useSettingsStore.getState().foliaSettings.tunings.kinetic);
const setGlobal = (patch: object) => {
    const state = useSettingsStore.getState().foliaSettings;
    useSettingsStore.getState().setFoliaSettings({ tunings: { ...state.tunings, kinetic: normalizeKineticTuning(patch) } });
};
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.removeItem('kinetic_projects');
    setGlobal({ style: 'paper', motion: 0.25, scope: 'global' });
    usePlayerStore.setState({ currentTrack: track, duration: 100, lyric: '[00:01.00]Alpha' });
});
afterEach(() => {
    usePlayerStore.getState().reset();
    localStorage.removeItem('kinetic_projects');
    setGlobal({});
    vi.unstubAllGlobals();
});
describe('kinetic global and per-song modes', () => {
    it('defaults to global and migrates the previous project switch without overriding an explicit mode', () => {
        expect(normalizeKineticTuning({}).scope).toBe('global');
        expect(normalizeKineticTuning({ useSongProject: true }).scope).toBe('song');
        expect(normalizeKineticTuning({ useSongProject: false }).scope).toBe('global');
        expect(normalizeKineticTuning({ scope: 'global', useSongProject: true }).scope).toBe('global');
    });
    it('preserves global settings across mode switches and automatically saves edits only to the current song', () => {
        kineticScopedSettings().handleSetKineticTuning({ scope: 'song' });
        expect(kineticScopedSettings().kineticTuning).toMatchObject({ scope: 'song', style: 'paper', motion: 0.25 });
        expect(readKineticProject('netease:1')).toBeNull();
        kineticScopedSettings().handleSetKineticTuning({ style: 'mint', motion: 0.8 });
        expect(readKineticProject('netease:1')).toMatchObject({ style: 'mint', fx: { motion: 0.8 } });
        expect(settings()).toMatchObject({ scope: 'song', style: 'paper', motion: 0.25 });
        expect(useVisualizerSettingsStore.getState().kineticTuning).toMatchObject({ style: 'mint', motion: 0.8 });
        kineticScopedSettings().handleSetKineticTuning({ scope: 'global' });
        kineticScopedSettings().handleSetKineticTuning({ style: 'gold' });
        expect(settings().style).toBe('gold');
        expect(readKineticProject('netease:1')?.style).toBe('mint');
        kineticScopedSettings().handleSetKineticTuning({ scope: 'song' });
        expect(kineticScopedSettings().kineticTuning.style).toBe('mint');
        usePlayerStore.setState({ currentTrack: { ...track, source: 'tencent', id: 'queue-b' }, lyric: '[00:01.00]Bravo' });
        expect(useVisualizerSettingsStore.getState().kineticTuning.style).toBe('gold');
        kineticScopedSettings().handleSetKineticTuning({ style: 'noir' });
        expect(readKineticProject('tencent:1')?.style).toBe('noir');
        expect(readKineticProject('netease:1')?.style).toBe('mint');
    });
    it('rejects deferred saves after changing song, source lyrics, or mode', () => {
        kineticScopedSettings().handleSetKineticTuning({ scope: 'song' });
        const old = kineticScopedSettings();
        usePlayerStore.setState({ currentTrack: { ...track, id: 'queue-b', urlId: '2' }, lyric: '[00:01.00]Bravo' });
        old.handleSetKineticTuning({ style: 'mint' });
        expect(readKineticProject('netease:1')).toBeNull();
        expect(readKineticProject('netease:2')).toBeNull();
        const beforeLyrics = kineticScopedSettings();
        usePlayerStore.setState({ lyric: '[00:02.00]Bravo' });
        beforeLyrics.handleSetKineticTuning({ style: 'mint' });
        expect(readKineticProject('netease:2')).toBeNull();
        const beforeMode = kineticScopedSettings();
        beforeMode.handleSetKineticTuning({ scope: 'global' });
        beforeMode.handleSetKineticTuning({ style: 'mint' });
        expect(settings().style).toBe('paper');
    });
    it('resets only the active scope and supports songs without loaded lyrics', () => {
        writeKineticProject('netease:1', { style: 'mint' });
        writeKineticProject('tencent:1', { style: 'gold' });
        kineticScopedSettings().handleSetKineticTuning({ scope: 'song' });
        kineticScopedSettings().handleResetKineticTuning();
        expect(readKineticProject('netease:1')).toBeNull();
        expect(readKineticProject('tencent:1')?.style).toBe('gold');
        expect(settings().style).toBe('paper');
        usePlayerStore.getState().reset();
        kineticScopedSettings().handleSetKineticTuning({ style: 'mint' });
        expect(readKineticProject('netease:1')).toBeNull();
        kineticScopedSettings().handleSetKineticTuning({ scope: 'global' });
        kineticScopedSettings().handleResetKineticTuning();
        expect(settings()).toMatchObject({ scope: 'global', style: 'noir' });
        expect(readKineticProject('tencent:1')?.style).toBe('gold');
    });
    it('previews a per-song slider draft and persists it once on release through the existing gate', () => {
        kineticScopedSettings().handleSetKineticTuning({ scope: 'song' });
        kineticScopedSettings().handleSetKineticTuning({ style: 'mint' });
        let current!: ReturnType<typeof useTuningDrafts>;
        function Harness() {
            const held = useVisualizerSettingsStore();
            const draft = useTuningDrafts(held);
            useLayoutEffect(() => { current = draft; });
            return null;
        }
        const host = document.createElement('div');
        const root = createRoot(host);
        const save = vi.spyOn(Storage.prototype, 'setItem');
        try {
            act(() => root.render(createElement(Harness)));
            act(() => current.onSliderPointerDown());
            act(() => current.styleDraft('kinetic').change({ motion: 0.4 }));
            act(() => current.styleDraft('kinetic').change({ motion: 0.9 }));
            expect(current.sampleTunings.kinetic).toMatchObject({ style: 'mint', motion: 0.9, previewDraft: true });
            expect(save).not.toHaveBeenCalled();
            act(() => current.onSliderCommit());
            expect(save.mock.calls.filter(call => call[0] === 'kinetic_projects')).toHaveLength(1);
            expect(readKineticProject('netease:1')).toMatchObject({ fx: { motion: 0.9 } });
            expect(settings().motion).toBe(0.25);
            expect(current.sampleTunings.kinetic).not.toHaveProperty('previewDraft');
        } finally {
            act(() => root.unmount());
            save.mockRestore();
        }
    });
});
