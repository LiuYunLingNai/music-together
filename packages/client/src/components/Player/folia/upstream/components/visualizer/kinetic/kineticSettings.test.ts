import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { normalizeFoliaSettings } from '@/lib/foliaSettings';
import { createFoliaTuningResolver } from '@/components/Player/folia/stage/foliaTunings';
import {
    KINETIC_LAYOUTS, KINETIC_STYLES, DEFAULT_KINETIC_TUNING, normalizeKineticTuning,
    kineticProjectFromTuning, makeKineticSongProject, importKineticSongProject, kineticEditedLyricsMatchTiming,
} from './kineticSettings';

const source = '[00:01.00]Alpha\n[00:12.00]Bravo';
describe('native kinetic settings', () => {
    it('only offers styles and layouts that exist in the shipped engine', () => {
        const engine = fs.readFileSync(new URL('../../../../../../../../public/jizura/jizura.engine.js', import.meta.url), 'utf8');
        const context = { window: {} as { J: { STYLE_ORDER: string[]; LAYOUT_ORDER: string[] } }, document: { createElement: () => ({ getContext: () => ({}) }) }, console };
        vm.runInNewContext(engine, context);
        expect(KINETIC_STYLES.map(style => style.value)).toEqual(Array.from(context.window.J.STYLE_ORDER));
        for (const item of KINETIC_LAYOUTS.filter(layout => layout.value !== 'auto')) expect(context.window.J.LAYOUT_ORDER).toContain(item.value);
    });
    it('normalizes ranges, ignores invalid stored values and reaches the host renderer', () => {
        expect(normalizeKineticTuning({ style: 'missing', seed: NaN, flash: 'true', motion: 9, decor: -1, hud: 'bad' })).toMatchObject({
            style: 'noir', seed: DEFAULT_KINETIC_TUNING.seed, flash: false, motion: 1, decor: 0, hud: 'auto',
        });
        const settings = normalizeFoliaSettings({ tunings: { kinetic: { style: 'paper', layout: 'stack', seed: 42, motion: 0.3, useSongProject: false } } });
        const resolve = createFoliaTuningResolver(settings);
        expect(resolve('kinetic').kineticTuning).toMatchObject({ style: 'paper', layout: 'stack', seed: 42, motion: 0.3, scope: 'global' });
        expect(resolve('kinetic')).toBe(resolve('kinetic'));
    });
    it('maps controls into real project fields and leaves timed lyrics on the host clock', () => {
        const project = kineticProjectFromTuning({ ...DEFAULT_KINETIC_TUNING, style: 'paper', motion: 0.1, layout: 'stack', colorSource: 'style', typeset: true });
        expect(project).toMatchObject({ style: 'paper', typeset: true, hostLayout: 'stack', fx: { motion: 0.1, koma: 0, onTwos: false }, colors: { enabled: false }, timing: { offset: 0, snap: false } });
    });
    it('saving a new look invalidates old plans but keeps edits only for the same source', () => {
        const saved = { sourceLyrics: source, lyrics: source.replace('Alpha', 'Alpha edited'), plan: { old: true }, overrides: { '0': { layout: 'center' } } };
        const project = makeKineticSongProject(DEFAULT_KINETIC_TUNING, source, saved);
        expect(project.lyrics).toBe(saved.lyrics);
        expect(project.plan).toBeUndefined();
        expect(project.overrides).toBeUndefined();
        expect(makeKineticSongProject(DEFAULT_KINETIC_TUNING, '[00:01.00]Other', saved).lyrics).toBe('[00:01.00]Other');
    });
    it('round-trips a native project and rejects imports for another song or changed timings', () => {
        const project = { ...makeKineticSongProject({ ...DEFAULT_KINETIC_TUNING, style: 'mint', layout: 'ring' }, source, null), lyrics: source.replace('Bravo', 'Bravo edited') };
        expect(importKineticSongProject(JSON.stringify(project), source)).toMatchObject({ style: 'mint', hostLayout: 'ring', lyrics: project.lyrics, sourceLyrics: source });
        expect(() => importKineticSongProject(JSON.stringify(project), '[00:01.00]Other')).toThrow('其他歌曲');
        expect(() => importKineticSongProject(JSON.stringify({ ...project, lyrics: '[00:99.00]edited' }), source)).toThrow('时间标签');
        expect(() => importKineticSongProject(JSON.stringify({ style: 'paper', lyrics: 'Other' }), source)).toThrow('不一致');
        expect(() => importKineticSongProject('{}', source)).toThrow('风格');
        expect(() => importKineticSongProject('x'.repeat(524289), source)).toThrow('512 KB');
        expect(kineticEditedLyricsMatchTiming('[00:01.00]Changed\nuntagged', source)).toBe(false);
    });
});
