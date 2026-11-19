import { describe, expect, it } from 'vitest';
import {
    PROMPT_VOCAB,
    promptVocabLabel,
    promptVocabPick,
} from './promptVocab';

// 词表是脚本从 tokenizer.json 抽出来的一坨数据，脚本错了这里会立刻炸：
// 词不是两个汉字 / id 撞车 / 解析出 NaN —— 都会让面板上出现空白或同一个词重复三遍。

describe('promptVocab', () => {
    it('每条都是「两个汉字 + 0–29999 的 id」', () => {
        expect(PROMPT_VOCAB.length).toBeGreaterThan(200);
        PROMPT_VOCAB.forEach(entry => {
            expect(entry.text).toMatch(/^[\u4e00-\u9fff]{2}$/);
            expect(Number.isInteger(entry.id)).toBe(true);
            expect(entry.id).toBeGreaterThanOrEqual(5);
            expect(entry.id).toBeLessThan(30000);
        });
    });

    it('id 唯一且升序（解析不能把 id 读丢）', () => {
        const ids = PROMPT_VOCAB.map(entry => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('同一个 (种子, 槽位) 永远同一个词', () => {
        for (const seed of [0, 1, 0x2a, 987654321]) {
            expect(promptVocabPick(seed, 2)).toEqual(promptVocabPick(seed, 2));
        }
    });

    it('同屏几个槽位不会取到同一个词', () => {
        for (let seed = 0; seed < 500; seed += 1) {
            const texts = [0, 1, 2, 3, 4].map(slot => promptVocabPick(seed, slot).text);
            expect(new Set(texts).size).toBe(texts.length);
        }
    });

    it('印出来的 id 是五位数字，且和词对得上', () => {
        for (let seed = 0; seed < 50; seed += 1) {
            const label = promptVocabLabel(seed, 0);
            expect(label).toMatch(/^\d{5}$/);
            expect(Number(label)).toBe(promptVocabPick(seed, 0).id);
        }
    });
});
