import { describe, expect, it } from 'vitest';
import { compilePromptBoxes } from '@/components/Player/folia/upstream/components/visualizer/prompt/promptProgram';
import type { Line } from '@/components/Player/folia/upstream/types';

// test/unit/visualizer/promptProgram.test.ts
// 「提示词」样式的节目单：一句一个框、顺序按时间、没有逐词时间时怎么摊，以及
// 「编译是确定性的」（同一首歌重搭框不换面孔 —— 面板里那串 token id 与采样值都靠这个稳定）。

const wordedLine = (id: string, start: number, end: number, words: string[]): Line => ({
    id,
    startTime: start,
    endTime: end,
    fullText: words.join(' '),
    words: words.map((text, index) => ({
        text,
        // 四个词均分这一句的时长
        startTime: start + ((end - start) / words.length) * index,
        endTime: start + ((end - start) / words.length) * (index + 1),
    })),
});

const plainLine = (id: string, start: number, end: number, text: string): Line => ({
    id,
    startTime: start,
    endTime: end,
    fullText: text,
    words: [],
});

describe('compilePromptBoxes', () => {
    it('gives one box per sung line and drops the empty ones', () => {
        const lines = [
            wordedLine('a', 0, 3, ['one', 'two']),
            plainLine('gap', 3, 4, '   '),
            wordedLine('b', 4, 7, ['three']),
        ];
        const boxes = compilePromptBoxes(lines, 'song');
        expect(boxes.map(box => box.id)).toEqual(['a', 'b']);
        expect(boxes[0].words.map(word => word.text)).toEqual(['one', 'two']);
    });

    it('orders the boxes by time even when the lyric set is out of order', () => {
        const boxes = compilePromptBoxes([
            wordedLine('late', 20, 24, ['late']),
            wordedLine('early', 2, 6, ['early']),
        ], 'song');
        expect(boxes.map(box => box.id)).toEqual(['early', 'late']);
    });

    it('keeps the word timings a word-synced lyric already has', () => {
        const boxes = compilePromptBoxes([wordedLine('a', 10, 12, ['a', 'b'])], 'song');
        expect(boxes[0].words[0].startTime).toBeCloseTo(10, 5);
        expect(boxes[0].words[1].startTime).toBeCloseTo(11, 5);
        // 框要活到最后一个词唱完，不能停在行首的时间窗上。
        expect(boxes[0].endTime).toBeGreaterThanOrEqual(boxes[0].words[1].endTime);
    });

    /*
     * 中文的 `line.words` 多数是**逐字**的（一个字一条时间）。照它原样用就是「一个字一个词」：
     * 下划线一根一个字，AI 标的高亮色也匹配不上（`wordColors` 里存的是「大家」，
     * 切开了只剩「大」「家」）。这里要的是合并回词，时间从字符区间上取。
     */
    it('merges per-character Chinese timings back into whole words', () => {
        const line: Line = {
            id: 'zh',
            startTime: 0,
            endTime: 4,
            fullText: '大家天空',
            words: ['大', '家', '天', '空'].map((text, index) => ({
                text,
                startTime: index,
                endTime: index + 1,
            })),
        };
        const words = compilePromptBoxes([line], 'song')[0].words;
        expect(words.map(word => word.text)).toEqual(['大家', '天空']);
        // 「大家」= 前两个字的时间（0→2），「天空」= 后两个字（2→4）。
        expect(words[0].startTime).toBeCloseTo(0, 5);
        expect(words[0].endTime).toBeCloseTo(2, 5);
        expect(words[1].startTime).toBeCloseTo(2, 5);
        expect(words[1].endTime).toBeCloseTo(4, 5);
    });

    /*
     * 英文几乎每句都有词间空格，而词表给的 `text` 不含它 —— 于是「一个词的末尾」正好落在
     * 区间表留下的洞里，查不到就掉到兜底值（句尾）上，每个词的 end 于是都变成句尾：
     * 填充、残影、光标全在整句唱完那一刻一起结束、一起飞出去。
     */
    it('does not stretch every English word to the end of the line', () => {
        const line: Line = {
            id: 'en',
            startTime: 0,
            endTime: 4,
            fullText: 'hello world',
            words: [
                { text: 'hello', startTime: 0, endTime: 2 },
                { text: 'world', startTime: 2, endTime: 4 },
            ],
        };
        const words = compilePromptBoxes([line], 'song')[0].words;
        expect(words.map(word => word.text)).toEqual(['hello', 'world']);
        // 第一个词唱完是 2，不是「整句唱完」的 4。
        expect(words[0].startTime).toBeCloseTo(0, 5);
        expect(words[0].endTime).toBeCloseTo(2, 5);
        expect(words[1].startTime).toBeCloseTo(2, 5);
        expect(words[1].endTime).toBeCloseTo(4, 5);
    });

    it('spreads a line that only has a line-level window over its words', () => {
        const boxes = compilePromptBoxes([plainLine('a', 4, 8, '今天天气真好')], 'song');
        const words = boxes[0].words;
        expect(words.length).toBeGreaterThan(1);
        expect(words[0].startTime).toBeCloseTo(4, 5);
        // 首尾相接，最后一个词唱到行尾。
        for (let index = 1; index < words.length; index += 1) {
            expect(words[index].startTime).toBeCloseTo(words[index - 1].endTime, 5);
        }
        expect(words[words.length - 1].endTime).toBeCloseTo(8, 5);
    });

    it('compiles the same song the same way every time', () => {
        const lines = [
            wordedLine('a', 0, 3, ['one', 'two']),
            wordedLine('b', 3, 6, ['three']),
            wordedLine('c', 6, 9, ['four', 'five']),
        ];
        const first = compilePromptBoxes(lines, 'song');
        const second = compilePromptBoxes(lines, 'song');
        expect(second.map(box => [box.id, box.vocabSeed]))
            .toEqual(first.map(box => [box.id, box.vocabSeed]));
        // 换个种子就该换一批提示词/采样值 —— 不然「每个框都不一样」是假的。
        const other = compilePromptBoxes(lines, 'another-song');
        expect(other.map(box => box.vocabSeed)).not.toEqual(first.map(box => box.vocabSeed));
    });
});
