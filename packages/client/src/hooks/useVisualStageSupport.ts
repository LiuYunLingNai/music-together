import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  VISUAL_STAGE_DISABLED_QUERY,
  isVisualStageDisabled,
  resolveEffectiveVisualStage,
} from '@/lib/visualStageSupport'

/**
 * 本设备的**主指针是否为触摸**（即视觉舞台是否应禁用）。
 *
 * 判据与取值理由见 `lib/visualStageSupport.ts` 顶部说明 —— 要点是
 * **只用触摸判定、不用窗口宽度**，这样桌面端把窗口拖窄也不会丢入口。
 *
 * 支持热插拔：给平板接上鼠标（主指针变 `fine`）会触发 `change`，
 * 入口随之恢复。
 */
export function useVisualStageDisabled(): boolean {
  const [disabled, setDisabled] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : isVisualStageDisabled(window.matchMedia(VISUAL_STAGE_DISABLED_QUERY).matches),
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(VISUAL_STAGE_DISABLED_QUERY)
    const onChange = () => setDisabled(isVisualStageDisabled(mql.matches))
    // 首帧值与 effect 之间可能已发生变化（初始渲染与 effect 之间隔了一次
    // 提交，matchMedia 理论上可在其间翻转），故再同步一次而不是只挂监听。
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return disabled
}

/**
 * 视觉舞台的可用性 + 持久化值回写。
 *
 * ============================ 为什么要回写 ============================
 *
 * 用户决策：**视为 classic，并回写存储值**。
 *
 * 只做渲染层回落（不回写）会留下一个矛盾状态：存储里仍是 `emily`，用户在
 * 桌面上选了 Emily、换到手机后画面是经典播放器，而设置面板里「播放器模式」
 * 却高亮着 Emily —— 看起来像"舞台切换坏了"。回写后两侧一致。
 *
 * ★ 已知代价（诚实记录）：在**触摸设备上**回写会丢掉用户在桌面端选过的
 *   模式，回到桌面需重选。这是用户在两种方案里明确选择的一侧。
 *
 * ★ 回写放在 effect 里（不是渲染期）：渲染期写 store 会触发 React 的
 *   "渲染中更新状态"告警，且可能造成同一提交内的无限循环。
 */
export function useVisualStageSupport(): {
  /** 本设备是否禁用视觉舞台（主指针为触摸） */
  disabled: boolean
  /** 本设备**实际渲染**的舞台（禁用时恒为 classic） */
  effectiveVisualStage: ReturnType<typeof resolveEffectiveVisualStage>
} {
  const disabled = useVisualStageDisabled()
  const storedVisualStage = useSettingsStore((s) => s.visualStage)
  const setVisualStage = useSettingsStore((s) => s.setVisualStage)

  useEffect(() => {
    if (!disabled) return
    if (storedVisualStage === 'classic') return
    setVisualStage('classic')
  }, [disabled, storedVisualStage, setVisualStage])

  return { disabled, effectiveVisualStage: resolveEffectiveVisualStage(storedVisualStage, disabled) }
}
