/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
import type { Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { segmentLyricWords } from '../../../utils/lyrics/wordSegmentation';
import { segmentWithVocab } from './promptSegments';

// src/components/visualizer/prompt/promptProgram.ts
// 歌词 → 节目单：一句一个框。纯函数，不碰 pixi、不碰运行时 —— 所以既是运行时的输入，
// 也能单独测（「一句一框」「顺序按时间」「时长倒挂的歌词」「没有逐词时间那一档」）。
//
// 这里**不许出现 Math.random()**：运行时随时重绘、换尺寸会重搭框，随机只能在编译这一次发生，
// 否则同一个框每次重搭都换一副面孔（面板里的 token id 与采样值每次都不一样）。

/** 一个词在框里的内容与它被唱到的时间窗。 */
export interface PromptWordPlan {
    text: string;
    startTime: number;
    endTime: number;
}

/** 一句歌词 → 一个框。 */
export interface PromptBoxPlan {
    id: string;
    startTime: number;
    endTime: number;
    words: PromptWordPlan[];
    /** 决定这一句从词表里取哪几个词、印哪两个 token id。同一句每次重搭都取同一组（seek 安全）。 */
    vocabSeed: number;
}

/** FNV-1a：只用来把种子摊成一个稳定的数，不是密码学用途。 */
const hashString = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const lineStart = (line: Line) => (Number.isFinite(line.startTime) ? line.startTime : 0);

/** 一个「单字的汉字 / 假名 / 谚文」段 —— 连续一串这种段就是没被切开的中文。 */
const CJK_SINGLE = /^[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]$/;

interface CharSpan {
    start: number;
    end: number;
    startTime: number;
    endTime: number;
}

/**
 * 把 `line.words` 对到整行文本的字符区间上。
 *
 * 词表里的 `text` 拼起来应当就是这一行，按游标 `indexOf` 找（找得到就从那儿开始，找不到
 * 就退到游标处 —— 错位总比越界好）。有逐词时间戳时它是**唯一的时间来源**。
 */
const wordCharSpans = (line: Line, full: string): CharSpan[] => {
    const spans: CharSpan[] = [];
    const push = (start: number, end: number, startTime: number, endTime: number) => {
        if (end <= start) return;
        spans.push({ start, end, startTime, endTime });
    };
    /*
     * ⭐词与词之间的**空隙必须补上**（英文几乎每句都有）。
     *
     * 词表给的 `text` 一般不含尾随空格，于是 spans 之间会留下洞 —— 而「一个词的末尾」
     * 正好就落在这个洞里。查不到它属于哪条 word，就会掉到兜底值（句尾）上去，
     * 于是**每个词的 endTime 都变成句尾**：下划线的填充、残影、光标全都在整句唱完的
     * 那一刻一起结束、一起飞出去。中文没有词间空格，所以只有英文歌是这副样子。
     *
     * 补的那一段继承上一条的结束时间：它本来就是「上一个词唱完到下一个词开口」之间
     * 的那点空隙，取上一条的结束时间正好。
     */
    // 一句词都没有（不少 lrc 只有行级时间窗）：**不要凭空造一条区间** ——
    // 那会让下面以为「有逐词轴可映射」，于是整句每个词的时间都摊成同一个值。
    const spoken = (line.words ?? []).filter(word => (word.text ?? '').length > 0);
    if (spoken.length === 0) return [];

    let carried = Number.isFinite(spoken[0].startTime) ? spoken[0].startTime : lineStart(line);
    let cursor = 0;
    spoken.forEach(word => {
        const text = word.text ?? '';
        if (!text) return;
        let start = full.indexOf(text, cursor);
        if (start < 0) start = Math.min(cursor, full.length);
        const end = Math.min(full.length, start + text.length);
        push(cursor, start, carried, carried);
        push(start, end, word.startTime, word.endTime);
        if (Number.isFinite(word.endTime)) carried = word.endTime;
        cursor = end;
    });
    // 行尾剩下的那点（多半是空格）：同样接到最后一条的结束时间上。
    push(cursor, full.length, carried, carried);
    return spans;
};

/** 某个字符位置落在哪个区间里，就把那个区间的时间按字符比例插值给它。 */
const timeAt = (spans: readonly CharSpan[], offset: number, fallback: number): number => {
    for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index];
        if (offset < span.start || offset >= span.end) continue;
        const width = span.end - span.start;
        const ratio = width > 0 ? (offset - span.start) / width : 0;
        return span.startTime + (span.endTime - span.startTime) * ratio;
    }
    return fallback;
};

/**
 * 整行切成**词**（含它们在这一行里的字符区间）。
 *
 * `segmentLyricWords` 优先用 `Intl.Segmenter`，**安卓 WebView 上它常常不存在** → 掉到逐字
 * → 中文就变成一个字一个字（用户原话：只有中文是这样的）。所以切出来是连续单字的地方，
 * 再拿随包那本词表词典做最长匹配合并一遍 —— 和原生悬浮窗那边（FloatingVocab）同一套策略，
 * 于是两边看到的词是一致的。
 */
const splitWords = (line: Line, full: string): { text: string; start: number; end: number }[] => {
    const parts = segmentLyricWords(line);
    const out: { text: string; start: number; end: number }[] = [];
    let index = 0;
    while (index < parts.length) {
        const part = parts[index];
        if (!CJK_SINGLE.test(part.segment)) {
            if (part.segment.trim().length > 0) {
                out.push({ text: part.segment, start: part.index, end: part.index + part.segment.length });
            }
            index += 1;
            continue;
        }
        let last = index;
        while (last + 1 < parts.length && CJK_SINGLE.test(parts[last + 1].segment)) last += 1;
        const from = part.index;
        const to = parts[last].index + parts[last].segment.length;
        segmentWithVocab(full.slice(from, to)).forEach(sub => {
            if (sub.text.trim().length === 0) return;
            out.push({ text: sub.text, start: from + sub.start, end: from + sub.end });
        });
        index = last + 1;
    }
    return out;
};

/**
 * 一句的词与时间窗。
 *
 * ⭐**有逐词时间戳也要重新分词**：中文的 `line.words` 多数是逐字的（一个字一条时间），
 * 照它原样用就是「一个字一个词」—— 下划线一根一个字、AI 标的高亮色也匹配不上整词
 * （`wordColors` 里存的是「年少」，切开了就只剩「年」「少」）。
 * 现在一律按 `splitWords` 的词走，时间从**字符区间**映射到词上：词的起止分别取它首字符
 * 与末字符所在的那条 word 时间（区间内按字符比例插值）。
 *
 * 整行只给一个时间窗的（不少 lrc）没有 words 可映射，就按字数把这一句的时长摊开 ——
 * 和磁贴墙同一个切法，所以框里的词与墙上看到的是同一套切分。
 */
const promptWordsFor = (line: Line): PromptWordPlan[] => {
    const full = line.fullText ?? '';
    const parts = splitWords(line, full).filter(part => part.text.length > 0);
    if (parts.length === 0) return [];

    const spans = wordCharSpans(line, full);
    if (spans.length > 0) {
        const firstStart = spans[0].startTime;
        const lastEnd = spans[spans.length - 1].endTime;
        return parts.map(part => {
            const startTime = timeAt(spans, part.start, firstStart);
            const endTime = Math.max(startTime, timeAt(spans, part.end, lastEnd));
            return { text: part.text, startTime, endTime };
        });
    }

    const start = lineStart(line);
    // 摊的是这一句自己的时间窗；渲染提示（renderHints）里的余量留给框的收尾，不该拖慢字。
    const sung = Math.max(Number.isFinite(line.endTime) ? line.endTime : 0, start + 0.5);
    const total = parts.reduce((sum, part) => sum + part.text.length, 0) || 1;
    let cursor = start;
    return parts.map(part => {
        const span = (sung - start) * (part.text.length / total);
        const word = { text: part.text, startTime: cursor, endTime: cursor + span };
        cursor += span;
        return word;
    });
};

/**
 * 歌词 → 节目单。同一个 (lines, seed) 每次都给同一份。
 *
 * **刻意不吃主题**：主题对象在播放页每次重算都可能换一个引用，把它算进依赖里就会让「歌词没变、
 * 主题重建」也重编一遍节目单 —— 运行时会当作换歌重搭框，屏幕上就是一直在开场那一帧。
 * 框上那行提示词的「本首高亮词」由运行时搭框时现读 theme.wordColors，不进节目单。
 */
export const compilePromptBoxes = (
    lines: readonly Line[],
    seed: string | number,
): PromptBoxPlan[] => {
    const plans: PromptBoxPlan[] = [];
    lines.forEach((line, index) => {
        const words = promptWordsFor(line);
        if (words.length === 0) return;
        const start = lineStart(line);
        const end = Math.max(
            getLineRenderEndTime(line),
            words[words.length - 1].endTime,
            start + 0.6,
        );
        plans.push({
            id: line.id ?? `prompt-line-${index}-${start.toFixed(2)}`,
            startTime: start,
            endTime: end,
            words,
            vocabSeed: hashString(`${seed}:vocab:${start.toFixed(2)}`),
        });
    });
    // 歌词一般是顺序的，但「时间倒挂」的歌词集存在：框的顺序按时间走才追得对。
    plans.sort((left, right) => left.startTime - right.startTime);
    return plans;
};
