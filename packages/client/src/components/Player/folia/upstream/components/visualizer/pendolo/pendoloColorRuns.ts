/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
import { splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';

// src/components/visualizer/pendolo/pendoloColorRuns.ts

export interface PendoloColorRun {
    key: string;
    text: string;
    color: string;
}

/** Coalesces adjacent graphemes with the same resolved color into one shaping-safe text run. */
export const buildPendoloColorRuns = (
    text: string,
    graphemeStart: number,
    tokenColors: Map<string, string>,
    fallbackColor: string,
): PendoloColorRun[] => {
    const runs: PendoloColorRun[] = [];
    splitLyricGraphemes(text).forEach((grapheme, localIndex) => {
        const color = tokenColors.get(String(graphemeStart + localIndex)) ?? fallbackColor;
        const previous = runs[runs.length - 1];
        if (previous?.color === color) {
            previous.text += grapheme;
            return;
        }
        runs.push({ key: `${graphemeStart + localIndex}-${color}`, text: grapheme, color });
    });
    return runs;
};
