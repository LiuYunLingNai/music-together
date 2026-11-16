import type { LyricRenderOverride, LyricRenderScale } from '../../../types';
import { LYRIC_RENDER_SCALES, normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { numberWithin } from '../tuningDefinition';
import {
    DEFAULT_NEBBIA_TUNING,
    NEBBIA_APPEAR_STYLES,
    NEBBIA_BEHIND,
    NEBBIA_FADE_STYLES,
    NEBBIA_LAYOUTS,
    NEBBIA_GLASS,
    NEBBIA_GLASS_FOR,
    NEBBIA_LIMITS,
    NEBBIA_RAIN,
    NEBBIA_SCENERY,
    type NebbiaNumberKey,
    type NebbiaTuning,
} from './types';

// 雾笺 tuning 的归一化：存档、导入、同步与设置面板都经这里补齐字段、夹紧数值。

/** 一组开关：只留认得的、按固定顺序排，一个都没有就用默认。 */
const subsetOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T[]): T[] => {
    const picked = Array.isArray(value) ? choices.filter(c => value.includes(c)) : [];
    return picked.length ? picked : [...fallback];
};

/** 早期存的单选（appearMode / fadeMode）换成开关。 */
const LEGACY_APPEAR: Record<string, NebbiaTuning['appear']> = { auto: ['write', 'fade'], write: ['write'], fade: ['fade'] };
const LEGACY_FADE: Record<string, NebbiaTuning['fade']> = { fog: ['fog'], fingers: ['fingers'], mix: ['fog', 'fingers'] };

const readRender = (render: unknown, legacyResolution: unknown): LyricRenderOverride => {
    if (render !== undefined) return normalizeLyricRenderOverride(render);
    const override = normalizeLyricRenderOverride(null);
    if (legacyResolution === undefined) return override;
    const resolution = numberWithin(legacyResolution, 1, 0.5, 2);
    if (resolution === 1) return override;
    const scale = LYRIC_RENDER_SCALES.reduce<LyricRenderScale>(
        (best, next) => (Math.abs(next - resolution) <= Math.abs(best - resolution) ? next : best),
        LYRIC_RENDER_SCALES[0],
    );
    return { ...override, scale };
};

/** 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。 */
export const normalizeNebbiaTuning = (stored: unknown): NebbiaTuning => {
    const values = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof NebbiaTuning | 'appearMode' | 'fadeMode' | 'resolution', unknown>>;
    const base = DEFAULT_NEBBIA_TUNING;
    const numbers = Object.fromEntries((Object.keys(NEBBIA_LIMITS) as NebbiaNumberKey[]).map(key => [
        key,
        numberWithin(values[key], base[key], NEBBIA_LIMITS[key].min, NEBBIA_LIMITS[key].max),
    ])) as Pick<NebbiaTuning, NebbiaNumberKey>;
    const appear = values.appear ?? LEGACY_APPEAR[String(values.appearMode)];
    const fade = values.fade ?? LEGACY_FADE[String(values.fadeMode)];
    const behind = NEBBIA_BEHIND.find(b => b === values.behind) ?? base.behind;
    return {
        render: readRender(values.render, values.resolution),
        appear: subsetOf(NEBBIA_APPEAR_STYLES, appear, base.appear),
        fade: subsetOf(NEBBIA_FADE_STYLES, fade, base.fade),
        layouts: subsetOf(NEBBIA_LAYOUTS, values.layouts, base.layouts),
        behind,
        glass: NEBBIA_GLASS.find(g => g === values.glass) ?? NEBBIA_GLASS_FOR[behind] ?? base.glass,
        scenery: Array.isArray(values.scenery) ? NEBBIA_SCENERY.filter(c => (values.scenery as unknown[]).includes(c)) : [...base.scenery],
        rain: NEBBIA_RAIN.find(r => r === values.rain) ?? base.rain,
        credits: typeof values.credits === 'boolean' ? values.credits : base.credits,
        ...numbers,
    };
};
