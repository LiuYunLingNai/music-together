import { describe, expect, it } from 'vitest';
import { segmentWithVocab } from './promptSegments';

// 中文一句被切成一个字一个字，底下那条逐词下划线就白做了 —— 这条线的全部意义是
// 「按词切」。这组分词词典是随包打进去的（不依赖运行时有没有 Intl.Segmenter），
// 所以这里盯住两件事：**切出来是词**，以及**下标不错位**（下游拿它们去量宽）。

describe('segmentWithVocab', () => {
    it('切出来的段拼回去是原文，下标连续且对得上', () => {
        const text = '我们两个人在大海边，hello world';
        const parts = segmentWithVocab(text);
        expect(parts.map(part => part.text).join('')).toBe(text);
        let cursor = 0;
        parts.forEach(part => {
            expect(part.start).toBe(cursor);
            expect(part.end).toBe(cursor + part.text.length);
            expect(text.slice(part.start, part.end)).toBe(part.text);
            cursor = part.end;
        });
        expect(cursor).toBe(text.length);
    });

    it('词典里有的词合成一段', () => {
        const parts = segmentWithVocab('大家');
        expect(parts.map(part => part.text)).toEqual(['大家']);
    });

    it('西文连成词，空格与标点各自成段', () => {
        const parts = segmentWithVocab('hold me, tight');
        expect(parts.map(part => part.text)).toEqual([
            'hold', ' ', 'me', ',', ' ', 'tight',
        ]);
    });

    it('词典里没有的字各自成段（不会把它们硬合在一起）', () => {
        const parts = segmentWithVocab('啊哦嗯');
        expect(parts.every(part => part.text.length === 1)).toBe(true);
        expect(parts.length).toBe(3);
    });

    it('空串与纯空白不炸', () => {
        expect(segmentWithVocab('')).toEqual([]);
        expect(segmentWithVocab('   ').map(part => part.text)).toEqual(['   ']);
    });
});
