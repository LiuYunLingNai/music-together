import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence, useMotionValueEvent } from 'motion/react';
import type { MotionValue, Variants } from 'motion/react';
import type { Theme, Word as WordType } from '../types';
import { buildWordGraphemeTimings } from '../lib/graphemeTiming';
import { resolveThemeFontWeight } from '../lib/fontStacks';
import { wordGlowVariants } from './wordGlow';
import { getGlowWordActiveEndTime, getGlowWordDisplayDuration, type GlowWordRenderProfile } from './glowWordTiming';

// src/components/visualizer/GlowWord.tsx
// classic / partita 共用的单词组件：每个词只持有 waiting / active / passed 三态，状态变化才 setState；
// 逐字 glow 层、正文层与合唱涟漪都由各模式传入的 variants 驱动。布局差异（右边距、对齐）由 layoutStyle 传入。

/**
 * 由（起始时间, 文本）派生的确定性 0..1 值。
 *
 * 用于替代渲染期的 `Math.random()`（不纯，且每次挂载都变）。
 * 哈希与 `lib/wordColoring.ts` 等处的种子做法同源：FNV-1a 变体。
 */
const seededUnit = (seed: number, text: string): number => {
    let hash = 2166136261;
    const input = `${seed}|${text}`;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
};

export interface GlowWordProps<TConfig extends { id: string }> {
    word: WordType;
    config: TConfig;
    currentTime: MotionValue<number>;
    theme: Theme;
    layoutVariants: Variants;
    bodyVariants: Variants;
    baseColor: string;
    activeColor: string;
    renderProfile: GlowWordRenderProfile;
    isChorus?: boolean;
    fontSize: string;
    /** Mode-specific spacing merged into the word's own style (e.g. marginRight, alignSelf). */
    layoutStyle: React.CSSProperties;
}

export const GlowWord = <TConfig extends { id: string }>({
    word,
    config,
    currentTime,
    theme,
    layoutVariants,
    bodyVariants,
    baseColor,
    activeColor,
    renderProfile,
    isChorus,
    fontSize,
    layoutStyle,
}: GlowWordProps<TConfig>) => {
    const [status, setStatus] = useState<'waiting' | 'active' | 'passed'>('waiting');
    /**
     * 合唱涟漪的缩放幅度。
     *
     * ★ 上游用 `useMemo(() => 1.5 + Math.random() * 2, [])` —— 在渲染期调
     *   `Math.random()` 是**不纯**的（React Compiler 的 `react-hooks/purity`
     *   会报错），而且每次挂载都不同，同一句歌词重进时涟漪大小会变。
     *   这里改成按词身份派生的确定性值：观感上每个词仍有各自的幅度，
     *   但同一句歌词每次渲染一致（与本文件其它随机量都走种子的做法一致）。
     */
    const rippleScale = useMemo(() => 1.5 + seededUnit(word.startTime, word.text) * 2, [word.startTime, word.text]);
    const duration = getGlowWordDisplayDuration(word, renderProfile);
    const activeEndTime = getGlowWordActiveEndTime(word, renderProfile);
    const graphemeTimings = useMemo(() => buildWordGraphemeTimings(word), [word]);
    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        let newStatus: 'waiting' | 'active' | 'passed' = 'waiting';
        if (latest >= word.startTime - renderProfile.wordLookahead && latest <= activeEndTime) {
            newStatus = 'active';
        } else if (latest > activeEndTime) {
            newStatus = 'passed';
        }
        if (newStatus !== status) setStatus(newStatus);
    });

    return (
        <motion.div
            key={`${config.id}`}
            custom={{
                config,
                activeColor,
                baseColor,
                duration,
                wordRevealMode: renderProfile.wordRevealMode,
            }}
            variants={layoutVariants}
            initial="waiting"
            animate={status}
            // Add `whitespace-nowrap` to prevent unexpected line breaks
            className="inline-block origin-center relative will-change-transform whitespace-nowrap"
            style={{
                fontSize,
                fontWeight: resolveThemeFontWeight(theme, 700),
                lineHeight: 1.22,
                ...layoutStyle,
            }}
        >
            {/* Glow Layer - Handles Text Shadow - Absolute Position */}
            <span
                className="absolute inset-0 select-none pointer-events-none block"
                aria-hidden="true"
            >
                {graphemeTimings.length > 1 ? (
                    graphemeTimings.map((timing, index) => (
                        <motion.span
                            key={index}
                            variants={wordGlowVariants}
                            custom={{
                                config,
                                activeColor,
                                baseColor,
                                duration,
                                index,
                                total: graphemeTimings.length,
                                charStartTime: timing.startTime,
                                charEndTime: timing.endTime,
                                wordStartTime: word.startTime,
                                wordRevealMode: renderProfile.wordRevealMode,
                            }}
                        >
                            {timing.char}
                        </motion.span>
                    ))
                ) : (
                    <motion.span
                        variants={wordGlowVariants}
                        custom={{ config, activeColor, baseColor, duration, wordRevealMode: renderProfile.wordRevealMode }}
                    >
                        {word.text}
                    </motion.span>
                )}
            </span>

            {/* Body Layer - Handles Color and Blur - Relative Position */}
            <motion.span
                variants={bodyVariants}
                custom={{ config, activeColor, baseColor, duration, wordRevealMode: renderProfile.wordRevealMode }}
                className="relative z-10 block"
            >
                {word.text}
            </motion.span>

            {/* Chorus Ripple Effect */}
            <AnimatePresence>
                {isChorus && status === 'active' && (
                    <motion.span
                        key="ripple"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[150%] aspect-square rounded-full border-1 pointer-events-none z-0"
                        style={{ borderColor: activeColor, filter: 'blur(1px)' }}
                        initial={{ scale: 0.2, opacity: 0.8 }}
                        animate={{ scale: rippleScale, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};
