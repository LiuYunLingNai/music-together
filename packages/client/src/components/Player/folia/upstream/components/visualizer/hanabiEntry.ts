import { Frame, Sparkles } from 'lucide-react'
import type { HanabiTuning } from './hanabi/types'

/**
 * 花火在宿主注册表里的元数据（上游 `hanabi/entry.tsx` 的去 React 版本）。
 *
 * 上游每个模式有一个 `entry.tsx`，用 `defineVisualizer` 注册渲染器、设置面板、快捷开关与
 * 拍点效果声明；本仓的注册表是 `folia/renderers.ts` + `lib/foliaModes.ts` 两张纯数据表，
 * 设置面板由 `FoliaModeSettings` 按 `FOLIA_MODE_CONTROLS` 生成，拍点效果声明在
 * `@/services/beatFx/beatClockTargets`。这里只保留宿主真正要用的那部分：快捷开关。
 */

/** 上游 entry 的 `renderQuickControls`：两个快捷开关的图标与调参键。 */
export const HANABI_QUICK_CONTROLS = [
    { key: 'overlayFrame' as const, label: '画框', Glyph: Frame },
    { key: 'collage' as const, label: '拼贴', Glyph: Sparkles },
]

export type HanabiQuickControlKey = (typeof HANABI_QUICK_CONTROLS)[number]['key']

export const toggleHanabiQuickControl = (
    tuning: HanabiTuning,
    key: HanabiQuickControlKey,
): Partial<HanabiTuning> => (key === 'collage'
    ? { collage: tuning.collage > 0 ? 0 : 1 }
    : { overlayFrame: !tuning.overlayFrame })
