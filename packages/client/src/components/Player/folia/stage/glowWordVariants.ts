import type { Variants } from 'motion/react';
import type { Theme } from '../types';

// src/components/visualizer/glowWordVariants.ts
// classic / partita 的 GlowWord 用的 motion variants：外层容器（位置 / 缩放 / 旋转）与正文层（颜色 / 模糊）。

/**
 * `GlowWord` 传给 variants 的 `custom` 载荷。
 *
 * ★ 上游把这些参数声明成 `any`（`({ config }: any) => ...`）。本项目启用了
 *   `@typescript-eslint/no-explicit-any`，而且这些字段的形状其实是**已知的**
 *   —— 就是 `GlowWord` 自己构造的那几个键。因此这里给出精确类型：改
 *   `GlowWord` 的 custom 时类型检查会立刻指出漏改，而不是在运行时静默
 *   `undefined`（例如 `config.passedRotate` 缺失会让 `passed` 变 NaN）。
 */
export interface GlowWordLayoutCustom {
  config: {
    x: number;
    y: number;
    rotate: number;
    scale: number;
    passedRotate: number;
  };
}

export interface GlowWordBodyCustom {
  baseColor: string;
  activeColor: string;
  duration?: number;
  wordRevealMode?: 'normal' | 'fast' | 'instant';
}

// Container motion is the "body" of each word.
// waiting/active/passed all reuse the same layout config but interpret it differently.
export const buildGlowWordLayoutVariants = (
    animationIntensity: Theme['animationIntensity'],
    enableWordRotation = true,
): Variants => ({
    waiting: ({ config }: GlowWordLayoutCustom) => ({
        opacity: 0,
        scale: 0.5,
        x: config.x + (Math.sin(config.y) * 100),
        y: config.y + (Math.cos(config.x) * 50),
        rotate: enableWordRotation ? config.rotate + 20 : 0,
        transition: { duration: 0.4 }
    }),
    active: ({ config }: GlowWordLayoutCustom) => ({
        opacity: 1,
        scale: Number.isNaN(config.scale) ? 1.5 : config.scale * 1.4,
        x: config.x,
        y: config.y,
        rotate: config.rotate,
        transition: {
            type: "spring" as const,
            stiffness: 200,
            damping: 20,
            opacity: { duration: 0.1 }
        }
    }),
    passed: ({ config }: GlowWordLayoutCustom) => ({
        opacity: animationIntensity === 'chaotic' ? 0.9 : 0.82,
        scale: config.scale || 1,
        x: config.x,
        y: config.y,
        rotate: config.rotate + config.passedRotate,
        transition: {
            duration: 0.5,
            rotate: {
                duration: 5,
                ease: "linear"
            }
        }
    })
});

// Body layer is where color transition and blur cleanup happen.
// Glow is separated so we can overdrive highlight without making the actual glyph unreadable.
export const glowWordBodyVariants: Variants = {
    waiting: ({ baseColor }: GlowWordBodyCustom) => ({
        color: baseColor,
        filter: "blur(10px)",
        transition: { duration: 0.4 }
    }),
    active: ({ activeColor, duration, wordRevealMode }: GlowWordBodyCustom) => ({
        color: activeColor,
        filter: "none",
        transition: {
            color: { duration: duration || 0.2, ease: "linear" },
            filter: { type: "tween", duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2 }
        },
        transitionEnd: {
            filter: "none"
        }
    }),
    passed: ({ baseColor, wordRevealMode }: GlowWordBodyCustom) => ({
        color: baseColor,
        filter: "blur(0px)",
        transition: {
            color: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8, ease: "easeInOut" },
            filter: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5 }
        },
        transitionEnd: {
            filter: "none"
        }
    })
};
