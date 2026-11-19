// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/stores/playerStore';
import KineticSettingsPanel from './KineticSettingsPanel';
import { DEFAULT_KINETIC_TUNING, kineticLrc } from './kineticSettings';
import { readKineticProject, writeKineticProject } from './kineticProjectMemory';
import { usePlaybackStore } from '../../../adapters/kineticPlayback';
import type { VisualizerSettingsPanelProps } from '../definition';
import type { KineticTuning } from './kineticSettings';

let root: Root;
let container: HTMLDivElement;
const song = { id: 'queue-a', title: 'Alpha', artist: [], album: '', cover: '', duration: 100, source: 'netease' as const, sourceId: '1', urlId: '1' };
const props: VisualizerSettingsPanelProps<KineticTuning> = {
    t: key => key, isDaylight: false, controlCardBg: '#000', rangeInputClass: '', tuning: DEFAULT_KINETIC_TUNING,
    theme: { name: 'test', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#fff', secondaryColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
};
const button = (text: string) => [...container.querySelectorAll('button')].find(item => item.textContent === text)!;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    usePlayerStore.getState().reset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    usePlayerStore.getState().reset();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
});
describe('native kinetic settings panel', () => {
    it('renders in the existing window with no editor iframe, and disables song actions while lyrics load', () => {
        act(() => root.render(createElement(KineticSettingsPanel, props)));
        expect(container.querySelector('iframe')).toBeNull();
        expect(container.textContent).not.toContain('打开原版编辑台');
        expect(container.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(7);
        expect(container.textContent).toContain('全局模式');
        expect(container.textContent).toContain('逐曲模式');
        expect(button('保存歌词')).toBeUndefined();
        act(() => root.render(createElement(KineticSettingsPanel, { ...props, tuning: { ...DEFAULT_KINETIC_TUNING, scope: 'song' } })));
        expect(button('保存歌词').disabled).toBe(true);
        expect(button('导入').disabled).toBe(true);
    });
    it('saves and clears only the current provider song, and switches parameter edits to native settings', () => {
        usePlayerStore.setState({ currentTrack: song, duration: 100, lyric: '[00:01.00]Alpha\n[00:12.00]Bravo' });
        const change = vi.fn();
        act(() => root.render(createElement(KineticSettingsPanel, { ...props, tuning: { ...DEFAULT_KINETIC_TUNING, scope: 'song', style: 'paper', motion: 0.2 }, onTuningChange: change })));
        act(() => button('重新编排').click());
        expect(change.mock.lastCall?.[0]).not.toHaveProperty('scope');
        expect(change.mock.lastCall?.[0].seed).toEqual(expect.any(Number));
        act(() => button('保存歌词').click());
        expect(readKineticProject('netease:1')).toMatchObject({ style: 'paper', fx: { motion: 0.2 }, sourceLyrics: kineticLrc(usePlaybackStore.getState().lyrics!.lines) });
        act(() => writeKineticProject('tencent:1', { style: 'mint' }));
        act(() => button('恢复全局配置').click());
        expect(readKineticProject('netease:1')).toBeNull();
        expect(readKineticProject('tencent:1')?.style).toBe('mint');
    });
    it('ignores an import that finishes after switching songs', async () => {
        usePlayerStore.setState({ currentTrack: song, duration: 100, lyric: '[00:01.00]Alpha' });
        act(() => root.render(createElement(KineticSettingsPanel, { ...props, tuning: { ...DEFAULT_KINETIC_TUNING, scope: 'song' } })));
        let finish!: (text: string) => void;
        const text = new Promise<string>(resolve => { finish = resolve; });
        const input = container.querySelector('input[type="file"]')!;
        Object.defineProperty(input, 'files', { value: [{ size: 100, text: () => text }] });
        act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
        act(() => usePlayerStore.setState({ currentTrack: { ...song, id: 'queue-b', urlId: '2', title: 'Bravo' }, lyric: '[00:01.00]Bravo' }));
        await act(async () => { finish(JSON.stringify({ style: 'paper', lyrics: '[00:01.00]Alpha' })); await text; });
        expect(readKineticProject('netease:1')).toBeNull();
        expect(readKineticProject('netease:2')).toBeNull();
    });
    it('commits a held slider before switching modes', () => {
        const order: string[] = [];
        const change = vi.fn(patch => order.push(patch.scope));
        act(() => root.render(createElement(KineticSettingsPanel, { ...props, onSliderCommit: () => order.push('commit'), onTuningChange: change })));
        act(() => button('逐曲模式').click());
        expect(order).toEqual(['commit', 'song']);
        expect(change).toHaveBeenCalledWith({ scope: 'song' });
    });
});
