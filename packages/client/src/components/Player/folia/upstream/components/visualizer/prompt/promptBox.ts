/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/purity, react-refresh/only-export-components -- Adapted upstream visual runtime and its existing imperative lifecycle. */
// src/components/visualizer/prompt/promptBox.ts
// 「提示词输入框」那一套 UI —— **播放器里**用的是最早那版的全套东西：四角定位刻线、› 提示符、
// 右上角 ⏎ 键帽、逐词方括号、每个词底下各自一串 token id、卡拉 OK 进度、字后光标。
// 外面仍然是一块半透明圆角墨底的悬浮窗（窗宽跟着字数收放，不铺满整屏）。
//
//   ╭───────────────────────────────────╮
//   │ › 我们 都曾 年少             ⏎    │  ← 四角刻线 + › + 键帽
//   │   ▁▁▁▁  ▁▁▁▁  ▁▁▁▁                │  ← 卡拉 OK（唱到哪填到哪）
//   │   15082  2279  1188                │  ← 每词一个词表 id（分词看得见）
//   ╰───────────────────────────────────╯
//
// 应用外那个原生悬浮窗（wallpaper/FloatingLyricsOverlay.java）是同一套画法的精简版：
// 只要框 + 逐词下划线，四角刻线 / › / 键帽 / 一串 id 都不画（窗太小，画了就糊）。
// 改这一份的时候那边要不要跟着改，得问一句。
//
// 下划线是「分词」唯一看得见的地方：一句切成几个 token、唱到第几个，全在这条线上。
// 正在唱的那个词下面会浮出它在词表里的 id（一次只一个，不糊）。
//
// **只认几何与时间**，不认歌词引擎：独立的「提示词」样式（createPromptPixiRuntime）拿它搭场。
// 单位是画面 px（不整层缩放），这里写 13 就是屏上的 13px。
//
// 商籁不再有自己的输入框镜头（原 sonnet/sonnetPromptField.ts 已删）：提示词是独立样式，
// 有自己的运行时，和商籁那套分镜没有关系。

import { promptVocabIdFor } from './promptTokenId';

type PixiModule = typeof import('pixi.js');

/** pdoom-video 的调色板：墨底、骨白细线、信号橙。主题色由调用方覆盖。 */
export const PROMPT_PALETTE = {
    ink: '#0A0A0B',
    ink2: '#151517',
    graphite: '#5E5B57',
    ash: '#9C978F',
    bone: '#EEE9DF',
    signal: '#FF4D12',
} as const;

/** token id 这类「不是歌词」的小字用等宽，歌词本身用主题字体。 */
export const PROMPT_MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const easeInCubic = (value: number) => value * value * value;
const progressOf = (time: number, start: number, end: number) => (
    end <= start ? (time >= end ? 1 : 0) : clamp01((time - start) / (end - start))
);

/**
 * 一句装不下时最多缩到原字号的这个比例，再小就不缩了（剩下的交给镜头跟）。
 *
 * 别往上调：英文一句的词又多又宽，缩不动就变成「内容比窗宽出一截」，而镜头能横移的
 * 余量只有窗比屏幕宽出来的那一点 —— 结果是后面的词永远跟不到（用户看到的
 * 「英文歌才会这样：竖屏也飞出屏幕」）。宁可把长句的字缩小一点，也要让它装得下。
 */
const MIN_SHRINK = 0.4;
/** 词与词之间的空隙占字号的比例。 */
const WORD_GAP = 0.3;

export interface PromptCardToken {
    text: string;
    startTime: number;
    endTime: number;
}

export interface PromptCardSpec {
    /** 窗最多能有多宽（屏宽的一部分）。整句装不下就缩字，缩到底才靠镜头跟。 */
    maxWidth: number;
    /** 基础字号：已经乘过「歌词字号」那个全局系数。 */
    fontPx: number;
    /** 主题色：下划线填色、光标。 */
    accent: number;
    /** 主题的「字」色：没唱到的字、框线、下划线底。 */
    textColor: number;
    /** 歌词字体（主题字体栈）。 */
    fontFamily: string;
    fontWeight: string | number;
    tokens: readonly PromptCardToken[];
}

export interface PromptLaidToken {
    left: number;
    width: number;
}

export interface PromptCardView {
    root: import('pixi.js').Container;
    /** 歌词层：运行时把逐词 Text 加进来，坐标 0 就是「第一个词的左边」。 */
    textLayer: import('pixi.js').Container;
    /**
     * 残影层：与 textLayer 同一套坐标，但**不在裁剪范围内** —— 唱完飞出去的字要能飘到框外面。
     * 正文那层是被 mask 裁在窗里的，放这里才不会被一起裁掉。
     */
    ghostLayer: import('pixi.js').Container;
    /** 每个词量出来的位置与宽度（与 spec.tokens 同序）。 */
    laid: readonly PromptLaidToken[];
    /** 这一套的最终字号（缩过之后的）。 */
    fontPx: number;
    /** 窗宽 / 内容宽 / 内容区能有多宽（px），镜头算可移动范围用。 */
    windowWidth: number;
    contentWidth: number;
    contentSpan: number;
    /** 窗的矩形（相对窗中心）：镜头放大后要靠它算「还能往哪边移才不露出窗外」。 */
    left: number;
    top: number;
    windowHeight: number;
    /** 内容区左边界（窗坐标，等于第一个词的左边）。 */
    contentLeft: number;
    /** 字的竖中线（相对窗中心）。 */
    textY: number;
    /** 每帧：下划线、卡拉 OK、当前词的 id。 */
    update: (time: number, activeIndex: number) => void;
}

export const buildPromptCard = (
    pixi: PixiModule,
    spec: PromptCardSpec,
): PromptCardView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { tokens, accent, textColor } = spec;
    const ink = colorNumber(pixi, PROMPT_PALETTE.ink);

    // ---- 量宽：先用基础字号量一遍，装不下按比例缩（缩到底就停），窗宽再按最终宽度收放
    const metricsApi = (pixi as unknown as {
        CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
    }).CanvasTextMetrics;
    const measureStyle = new TextStyle({
        fontFamily: spec.fontFamily,
        fontWeight: spec.fontWeight as never,
        fontSize: spec.fontPx,
    });
    /*
     * 量宽必须拿**真的 TextStyle 实例**：CanvasTextMetrics.measureText 从 style 上读
     * `letterSpacing` / `_fontString` / `styleKey`，给普通对象就是 undefined → NaN → 整行消失。
     */
    const measure = (text: string, size: number): number => {
        try {
            const width = metricsApi ? metricsApi.measureText(text, measureStyle).width : Number.NaN;
            // 量不到就按字数估：宁可字宽估歪，不能让整行字和窗一起不见。
            return Number.isFinite(width) && width > 0 ? width : text.length * size * 0.62;
        } catch {
            return text.length * size * 0.62;
        }
    };

    /*
     * 左右各留一截（左边那截原本是给 › 提示符留的，现在 › 只在悬浮窗那边撤掉了、这边还画，
     * 顺手再放宽一点）：镜头推近时字两侧有余地，不会显得把整块窗塞满。
     */
    const padLeft = Math.round(spec.fontPx * 1.35);
    const padRight = Math.round(spec.fontPx * 1.1);
    const available = Math.max(120, spec.maxWidth - padLeft - padRight);
    const gaps = Math.max(0, tokens.length - 1) * spec.fontPx * WORD_GAP;

    let natural = gaps;
    tokens.forEach(token => { natural += measure(token.text, spec.fontPx); });
    const shrink = natural > available ? clamp(available / natural, MIN_SHRINK, 1) : 1;
    // 字号只往下缩，**绝不因为字少而放大** —— 两个字撑成一屏大的就是「字少时太难看」。
    const fontPx = spec.fontPx * shrink;
    const gap = fontPx * WORD_GAP;

    const laid: PromptLaidToken[] = [];
    let cursor = 0;
    tokens.forEach(token => {
        const width = measure(token.text, spec.fontPx) * shrink;
        laid.push({ left: cursor, width });
        cursor += width + gap;
    });
    const contentWidth = Math.max(1, cursor - (tokens.length > 0 ? gap : 0));
    const windowWidth = Math.min(spec.maxWidth, contentWidth + padLeft + padRight);

    // ---- 窗：半透明墨底 + 一圈细线 + 四角刻线 + › + ⏎ 键帽，就是最早那版的输入框。
    const underlineY = fontPx * 0.72;
    const windowHeight = fontPx * 2.35;
    const radius = Math.max(8, fontPx * 0.3);
    const left = -windowWidth / 2;
    const top = -windowHeight / 2;
    const textY = -fontPx * 0.28;
    const contentLeft = left + padLeft;

    const root = new Container();
    const plate = new Graphics()
        .roundRect(left, top, windowWidth, windowHeight, radius)
        .fill({ color: ink, alpha: 0.46 })
        .roundRect(left, top, windowWidth, windowHeight, radius)
        .stroke({ color: textColor, width: 1, alpha: 0.24 });
    root.addChild(plate);

    // 四角定位刻线（最早那版就有的那一手，去掉就不像那个输入框了）
    const tick = Math.max(6, fontPx * 0.22);
    const corner = { color: textColor, width: Math.max(1, fontPx * 0.025), alpha: 0.5 };
    [[left, top, -1, -1], [left + windowWidth, top, 1, -1],
        [left, top + windowHeight, -1, 1], [left + windowWidth, top + windowHeight, 1, 1]]
        .forEach(([x, y, sx, sy]) => {
            plate.moveTo(x + sx * 4, y).lineTo(x + sx * (4 + tick), y).stroke(corner);
            plate.moveTo(x, y + sy * 4).lineTo(x, y + sy * (4 + tick)).stroke(corner);
        });

    // › 提示符：两条线，比字体里那个符号稳
    const chevronSize = fontPx * 0.34;
    const chevronX = left + padLeft * 0.46;
    root.addChild(new Graphics()
        .moveTo(chevronX, textY - chevronSize * 0.46)
        .lineTo(chevronX + chevronSize * 0.5, textY)
        .lineTo(chevronX, textY + chevronSize * 0.46)
        .stroke({ color: textColor, width: Math.max(1.4, fontPx * 0.035), alpha: 0.7 }));

    /*
     * ⏎ 键帽：最后一个词开唱之前只是一圈暗轮廓，之后跟着呼吸，整句被抽走时实心闪一下。
     * 这是最早那版里最像「输入框」的一笔，留着。
     */
    const keySize = Math.max(9, fontPx * 0.4);
    const keyX = left + windowWidth - keySize - fontPx * 0.28;
    const keycap = new Graphics()
        .rect(keyX - keySize, -keySize, keySize * 2, keySize * 2)
        .stroke({ color: textColor, width: Math.max(1, fontPx * 0.022), alpha: 0.35 });
    const arrowX = keyX + keySize * 0.42;
    const arrowY = -keySize * 0.42;
    const arrow = { color: textColor, width: Math.max(1, fontPx * 0.025), alpha: 0.7 };
    keycap.moveTo(arrowX, arrowY).lineTo(arrowX, arrowY + keySize * 0.34)
        .lineTo(arrowX - keySize * 0.78, arrowY + keySize * 0.34).stroke(arrow);
    keycap.moveTo(arrowX - keySize * 0.78 + keySize * 0.3, arrowY + keySize * 0.34 - keySize * 0.28)
        .lineTo(arrowX - keySize * 0.78, arrowY + keySize * 0.34)
        .lineTo(arrowX - keySize * 0.78 + keySize * 0.3, arrowY + keySize * 0.34 + keySize * 0.28)
        .stroke(arrow);
    root.addChild(keycap);
    const keyFlash = new Graphics()
        .rect(keyX - keySize, -keySize, keySize * 2, keySize * 2)
        .fill({ color: accent, alpha: 1 });
    keyFlash.alpha = 0;
    root.addChild(keyFlash);

    const textLayer = new Container();
    textLayer.position.set(contentLeft, textY);
    /*
     * 装饰层：下划线 / 方括号 / token id 全挂这层。
     *
     * 它们和字用的是**同一套坐标**（0 = 第一个词的左边），而字那层有 (contentLeft, textY) 的
     * 偏移 —— 直接挂在 root 上就会整排往左偏掉一个 contentLeft（播放页之前就是这个样子）。
     */
    const decoLayer = new Container();
    decoLayer.position.set(contentLeft, textY);

    /*
     * 字与装饰塞进 contentLayer 并**裁在窗里**：一句太长时 promptBox 只把字号缩到 MIN_SHRINK
     * 就不再缩了，超出的部分会画到框外面去（小窗就更明显）。裁掉之后交给镜头横移去补。
     */
    const contentLayer = new Container();
    contentLayer.addChild(textLayer, decoLayer);
    root.addChild(contentLayer);

    // 残影层不进 contentLayer：字要飞出框外才像那个参考项目。
    const ghostLayer = new Container();
    ghostLayer.position.set(contentLeft, textY);
    root.addChild(ghostLayer);

    const clip = new Graphics()
        .roundRect(left, top, windowWidth, windowHeight, radius)
        .fill({ color: 0xffffff, alpha: 1 });
    root.addChild(clip);
    contentLayer.mask = clip;

    // ---- 逐词下划线（底 + 唱到的填充色）与「当前词」的 id
    const hair = Math.max(1.5, fontPx * 0.045);
    const idFont = Math.max(8, Math.round(fontPx * 0.2));
    const idStyle = new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFont, fill: '#ffffff' });

    const trackNodes: import('pixi.js').Graphics[] = [];
    const fillNodes: import('pixi.js').Graphics[] = [];
    const bracketNodes: import('pixi.js').Graphics[] = [];
    const idNodes: import('pixi.js').Text[] = [];
    const tickH = fontPx * 0.13;

    laid.forEach((token, index) => {
        const track = new Graphics()
            .rect(0, 0, token.width, hair)
            .fill({ color: textColor, alpha: 0.3 });
        track.position.set(token.left, underlineY);
        const fill = new Graphics()
            .rect(0, 0, 1, hair)
            .fill({ color: accent, alpha: 1 });
        fill.position.set(token.left, underlineY);
        fill.scale.x = 0.001;
        // 方括号两端那两道竖线：词的边界画出来，「分词」才看得见。
        const bracket = new Graphics()
            .rect(token.left - hair * 1.2, underlineY - tickH, hair, tickH + hair)
            .fill({ color: textColor, alpha: 0.42 })
            .rect(token.left + token.width, underlineY - tickH, hair, tickH + hair)
            .fill({ color: textColor, alpha: 0.42 });
        // 每个词自己在词表里的号：唱过的亮一档。
        const idText = new Text({ text: String(promptVocabIdFor(tokens[index].text)), style: idStyle });
        idText.anchor.set(0.5, 0);
        idText.position.set(token.left + token.width / 2, underlineY + hair * 2.6);
        idText.tint = textColor;
        idText.alpha = 0.3;
        decoLayer.addChild(track, fill, bracket, idText);
        bracketNodes.push(bracket);
        trackNodes.push(track);
        fillNodes.push(fill);
        idNodes.push(idText);
    });

    const lineStart = tokens.length ? Math.min(...tokens.map(token => token.startTime)) : 0;
    const lineEnd = tokens.length ? Math.max(...tokens.map(token => token.endTime)) : lineStart + 1;
    const lastStart = tokens.length ? Math.max(...tokens.map(token => token.startTime)) : lineStart;
    const exitDuration = clamp(Math.max(0.2, lineEnd - lineStart) * 0.2, 0.24, 0.42);

    const update = (time: number, activeIndex: number) => {
        laid.forEach((token, index) => {
            const source = tokens[index];
            const typed = progressOf(time, source.startTime, source.endTime);
            const age = time - source.startTime;
            const flash = age >= 0 && age < 0.2 ? 1 - age / 0.2 : 0;
            const settled = 1 - 0.4 * progressOf(time, source.endTime, source.endTime + 1.8);

            // 下划线：唱过的留亮，刚落下的那个词闪一下。
            trackNodes[index].alpha = (0.7 + 0.3 * flash) * settled;
            fillNodes[index].scale.x = Math.max(0.001, token.width * typed);
            fillNodes[index].alpha = (0.85 + 0.15 * flash) * settled;
            bracketNodes[index].tint = flash > 0.2 || index === activeIndex ? accent : 0xffffff;
            bracketNodes[index].alpha = (0.5 + 0.5 * flash) * settled;
            // 每个词的 id 都印着（那才是分词），唱过的亮一档；静态模式下也要看得见，所以直接给值。
            idNodes[index].alpha = (0.28 + 0.42 * typed) * settled;
        });

        // ⏎ 键帽：最后一个词开口后开始呼吸，整句被抽走时实心闪一下。
        const armed = time >= lastStart + 0.1 ? 1 : 0;
        keycap.alpha = (0.4 + 0.6 * armed * (0.6 + 0.4 * Math.cos(time * Math.PI * 4))) * clamp01(1 - keyFlash.alpha);
        keyFlash.alpha = easeInCubic(progressOf(time, lineEnd - exitDuration, lineEnd - exitDuration * 0.5));
    };

    return {
        root,
        textLayer,
        ghostLayer,
        laid,
        fontPx,
        windowWidth,
        contentWidth,
        contentSpan: available,
        left,
        top,
        windowHeight,
        contentLeft,
        textY,
        update,
    };
};
