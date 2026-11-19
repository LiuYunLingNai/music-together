import type { KineticProjectSnapshot } from './kineticProjectTypes';
import type { Line } from '../../../types';
import { kineticLyricsSignature, resolveKineticProjectLyrics } from './kineticEditorIdentity';

// IDs come from the bundled JIZURA engine; importing this catalog never loads the engine.
export const KINETIC_STYLES = [
    ['noir', '黑色电影'], ['crimson', '绯红信号'], ['caution', '警示'], ['magenta', '流行洋红'],
    ['paper', '纸与墨'], ['hud', '暗色终端'], ['mint', '薄荷终端'], ['specimen', '字样标本'],
    ['transit', '交通导视'], ['blueprint', '蓝图'], ['rouge', '胭脂渐变'], ['mono', '单色 RGB'],
    ['hrRuin', '废墟'], ['hrNightRec', '深夜录像'], ['hrCurse', '诅咒信件'],
    ['sakura', '樱花'], ['ocean', '深海'], ['sunset', '日落渐变'], ['forest', '森林手记'],
    ['vapor', '蒸汽波'], ['newsprint', '报纸'], ['synth80', '八十年代合成器'], ['kraft', '牛皮纸'],
    ['candy', '糖果'], ['acid', '酸性'], ['sumi', '墨与朱'], ['gold', '金色夜晚'],
].map(([value, label]) => ({ value, label }));

export const KINETIC_LAYOUTS = [
    ['auto', '自动编排'], ['center', '居中'], ['mixed', '大小错落'], ['vcols', '竖排'],
    ['marquee', '滚动文字'], ['tile', '平铺'], ['scatter', '散落'], ['ring', '圆环'],
    ['wave', '波浪'], ['huge', '超大文字'], ['labels', '标签'], ['condensed', '窄长文字'],
    ['gloss', '注释'], ['type', '打字'], ['diag', '斜向条带'], ['circle', '圆窗'],
    ['stack', '残影叠层'], ['pill', '胶囊'],
].map(([value, label]) => ({ value, label }));

export const KINETIC_EFFECTS = [
    ['motion', '动态强度'], ['glitch', '故障效果'], ['chroma', '色彩错位'],
    ['decor', '装饰量'], ['density', '镜头密度'], ['texture', '质感'], ['bgSwitch', '背景切换'],
] as const;
export type KineticEffect = (typeof KINETIC_EFFECTS)[number][0];
export type KineticTuning = Record<KineticEffect, number> & {
    style: string;
    layout: string;
    seed: number;
    colorSource: 'theme' | 'style';
    scope: 'global' | 'song';
    /** In-memory preview only; never normalized into persistence. */
    previewDraft?: boolean;
    flash: boolean;
    unify: boolean;
    typeset: boolean;
    extra: boolean;
    wa: boolean;
    horror: boolean;
    typo: boolean;
    kinetic: boolean;
    hud: 'auto' | 'on' | 'off';
    hideNo: boolean;
    hideTime: boolean;
};
export const DEFAULT_KINETIC_TUNING: KineticTuning = {
    style: 'noir', layout: 'auto', seed: 20260922, colorSource: 'theme', scope: 'global',
    motion: 0.7, glitch: 0.55, chroma: 0.7, decor: 0.5, density: 0.55, texture: 0.6, bgSwitch: 0.35,
    flash: false, unify: false, typeset: false, extra: false, wa: true, horror: false, typo: true, kinetic: true,
    hud: 'auto', hideNo: false, hideTime: false,
};

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
export function normalizeKineticTuning(value: unknown): KineticTuning {
    const input = record(value);
    const result = { ...DEFAULT_KINETIC_TUNING };
    for (const [key] of KINETIC_EFFECTS) {
        const number = input[key];
        if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.min(1, Math.max(0, number));
    }
    for (const key of ['flash', 'unify', 'typeset', 'extra', 'wa', 'horror', 'typo', 'kinetic', 'hideNo', 'hideTime'] as const) {
        if (typeof input[key] === 'boolean') result[key] = input[key];
    }
    if (typeof input.seed === 'number' && Number.isFinite(input.seed)) result.seed = Math.max(0, Math.min(2147483647, Math.round(input.seed)));
    if (KINETIC_STYLES.some(style => style.value === input.style)) result.style = input.style as string;
    if (KINETIC_LAYOUTS.some(layout => layout.value === input.layout)) result.layout = input.layout as string;
    if (input.colorSource === 'style' || input.colorSource === 'theme') result.colorSource = input.colorSource;
    if (input.hud === 'on' || input.hud === 'off' || input.hud === 'auto') result.hud = input.hud;
    if (input.scope === 'global' || input.scope === 'song') result.scope = input.scope;
    else if (typeof input.useSongProject === 'boolean') result.scope = input.useSongProject ? 'song' : 'global';
    return result;
}

export const kineticLrc = (lines: Line[]): string => lines.map(line => {
    const start = Math.max(0, line.startTime);
    return `[${String(Math.floor(start / 60)).padStart(2, '0')}:${(start % 60).toFixed(2).padStart(5, '0')}]${line.fullText}`;
}).join('\n');

/** Parameters edited in the host window, sent to JIZURA's native project fields. */
export function kineticProjectFromTuning(tuning: KineticTuning): KineticProjectSnapshot {
    return {
        style: tuning.style, seed: tuning.seed, unify: tuning.unify, typeset: tuning.typeset,
        extra: tuning.extra, wa: tuning.wa, horror: tuning.horror || tuning.style.startsWith('hr'),
        typo: tuning.typo, kinetic: tuning.kinetic,
        fx: { ...Object.fromEntries(KINETIC_EFFECTS.map(([key]) => [key, tuning[key]])),
            flash: tuning.flash, hud: tuning.hud, hideNo: tuning.hideNo, hideTime: tuning.hideTime,
            koma: 0, onTwos: false },
        // Real timed lyrics own their timing; the engine must not shift them onto another beat grid.
        timing: { offset: 0, snap: false, lineTimes: {}, lineScale: 1 },
        colors: tuning.colorSource === 'style' ? { enabled: false } : undefined,
        enabled: tuning.layout === 'auto' ? undefined : { layout: { [tuning.layout]: true } },
        hostLayout: tuning.layout,
    };
}

/** Explicitly selected layouts constrain the engine's complete registry, including later packs. */
export function makeKineticSongProject(tuning: KineticTuning, sourceLyrics: string, saved: KineticProjectSnapshot | null): KineticProjectSnapshot {
    return {
        ...kineticProjectFromTuning(tuning), sourceLyrics,
        lyrics: resolveKineticProjectLyrics(saved, sourceLyrics),
    };
}

export function kineticTuningFromProject(project: KineticProjectSnapshot, fallback = DEFAULT_KINETIC_TUNING): KineticTuning {
    return normalizeKineticTuning({ ...fallback, ...project, ...record(project.fx), layout: project.hostLayout ?? fallback.layout,
        colorSource: record(project.colors).enabled === false ? 'style' : 'theme' });
}

export function resolveKineticScopedTuning(global: KineticTuning, saved: KineticProjectSnapshot | null): KineticTuning {
    return global.scope === 'song' && saved ? { ...kineticTuningFromProject(saved, global), scope: 'song' } : global;
}

/** Text editing stays on the host's lyric timeline; timing calibration lives in the player. */
export function kineticEditedLyricsMatchTiming(text: string, source: string): boolean {
    const stamps = (lrc: string) => lrc.split('\n').filter(row => row.trim()).map(row => row.match(/^\[\d+:\d+\.\d+\]/)?.[0]);
    const sourceStamps = stamps(source), editedStamps = stamps(text);
    return text.length <= 80000 && sourceStamps.length === editedStamps.length
        && editedStamps.every((stamp, index) => Boolean(stamp) && stamp === sourceStamps[index]);
}

export function importKineticSongProject(text: string, sourceLyrics: string): KineticProjectSnapshot {
    if (text.length > 524288) throw new Error('工程文件不能超过 512 KB');
    const raw = record(JSON.parse(text));
    if (!Object.keys(raw).length || typeof raw.style !== 'string' || !KINETIC_STYLES.some(item => item.value === raw.style)) {
        throw new Error('工程缺少有效的文字 PV 风格');
    }
    if (raw.sourceLyrics !== undefined && raw.sourceLyrics !== sourceLyrics) throw new Error('这个工程属于其他歌曲或旧版本歌词');
    if (typeof raw.lyrics === 'string' && raw.sourceLyrics === undefined && kineticLyricsSignature(raw.lyrics) !== kineticLyricsSignature(sourceLyrics)) {
        throw new Error('工程歌词与当前歌曲不一致');
    }
    const tuning = kineticTuningFromProject(raw as KineticProjectSnapshot);
    const imported = makeKineticSongProject(tuning, sourceLyrics, null);
    // Source identity permits an exported project to retain deliberate text edits.
    if (typeof raw.lyrics === 'string' && raw.sourceLyrics === sourceLyrics) {
        if (!kineticEditedLyricsMatchTiming(raw.lyrics, sourceLyrics)) throw new Error('歌词的时间标签与当前歌曲不一致');
        imported.lyrics = raw.lyrics;
    }
    if (typeof record(raw.colors).bg === 'string') imported.colors = record(raw.colors);
    return imported;
}
