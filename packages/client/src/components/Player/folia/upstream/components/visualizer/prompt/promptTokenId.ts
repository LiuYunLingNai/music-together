/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
// src/components/visualizer/prompt/promptTokenId.ts
// 一个词 → 它在词表里的位置（面板上每词底下那串数字）。
//
// 词表里有的词直接用**真实 id**（promptVocab.ts 那 421 条是从 30000 词表里抽的真词真号）；
// 查不到的（多字词、英文、标点）按字面算一个稳定的号 —— 同一个词永远同一个号，
// 所以「同一个词在不同句子里 id 一样」这种细节是对的，看起来才像真的分词结果。

import { PROMPT_VOCAB } from './promptVocab';

const BY_TEXT = new Map<string, number>();
PROMPT_VOCAB.forEach(entry => {
    if (!BY_TEXT.has(entry.text)) BY_TEXT.set(entry.text, entry.id);
});

/** FNV-1a：只求稳定，不求随机质量。 */
const hashText = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** 词表 id：落在 [5, 29999]（0–4 是特殊 token，不拿来当词）。 */
export const promptVocabIdFor = (text: string): number => {
    const word = text.trim();
    if (!word) return 5;
    const hit = BY_TEXT.get(word);
    if (hit !== undefined) return hit;
    return 5 + (hashText(word) % 29995);
};
