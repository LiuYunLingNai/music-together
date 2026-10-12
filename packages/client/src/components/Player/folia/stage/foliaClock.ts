import { motionValue, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'

/**
 * Folia 舞台的逐帧时钟 —— 把本项目**已有的**两个时间源包成 MotionValue。
 *
 * ============================ 为什么要这一层 ============================
 *
 * folia 的五个模式全部按 `MotionValue<number>` 消费播放位置
 * （`.get()` / `.on('change')` / `useMotionValueEvent`）。而本项目里
 * **没有任何 MotionValue**：播放位置有两个来源（见 `lib/lyricPlayerBridge.ts`
 * 的说明）：
 *
 *   ① `usePlayerStore.currentTime` —— 被 `useHowl` 按
 *      `CURRENT_TIME_THROTTLE_MS = 100` 节流，即 **10 Hz**；
 *   ② `lyricPlayerBridge.getFrameTime()` —— `useHowl` 既有 rAF 循环**逐帧**
 *      写入的只读旁路，带 250ms 新鲜度窗口，陈旧时返回 `null`。
 *
 * 若直接订阅 store，逐字填充会按 ~100ms 离散跳变、激活行切换最多滞后
 * 100ms —— 这正是 `LyricStage.tsx` 里记录过的"同一首歌切到经典播放器就变
 * 顺滑"的可见不一致。因此这里**优先读 ②、回退到 ①**，与 WebGL 歌词舞台
 * 完全同源。
 *
 * ============================ 定时器释放 ============================
 *
 * ★ 只有在**播放中**才持有 rAF 循环：暂停后不再每帧空转（否则会持续唤醒
 *   合成器）。暂停/拖动进度条期间由 store 订阅兜住 —— 那条路径只更新
 *   store（见 `useHowl.ts`），订阅会立刻把值同步进 MotionValue，因此
 *   "暂停时拖进度条"同样立即反映到歌词。
 * ★ 卸载时取消 rAF 并退订，不留残余（红线：计时器必须在卸载时释放）。
 *
 * ★ 只在该值**真的变化**时写入：`useMotionValueEvent` 的订阅者不会因为
 *   重复写入同一帧而被无谓唤醒。
 */
export interface FoliaClock {
  /** 播放位置（秒），已应用歌词偏移。 */
  currentTime: MotionValue<number>
  /** 舞台是否处于播放中（供模式做节流判断）。 */
  isPlaying: boolean
}

/** 位置变化小于该阈值时不再通知订阅者（1ms），避免浮点抖动唤醒整棵树。 */
const TIME_EPSILON = 0.001

export function useFoliaClock(offsetMs: number): FoliaClock {
  const currentTime = useMemo(() => motionValue(0), [])
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const offsetSeconds = offsetMs / 1000

  // 偏移放进 ref：偏移变化不应重建 rAF 循环（重建会丢一帧并重新起循环）。
  // ★ 用 effect 同步而不是渲染期赋值（`offsetRef.current = ...`）：渲染期写
  //   ref 会被 React Compiler 判为"渲染中访问 ref"。代价是最多晚一帧生效 ——
  //   偏移只在换歌或拖动校准条时变，一帧的延迟不可感知；而 rAF 循环不必
  //   因校准拖动而反复重建，反而是更重要的收益。
  const offsetRef = useRef(offsetSeconds)
  useEffect(() => {
    offsetRef.current = offsetSeconds
  }, [offsetSeconds])
  const lastWrittenRef = useRef(Number.NaN)

  const write = useMemo(
    () => (seconds: number) => {
      const next = Math.max(0, seconds - offsetRef.current)
      const last = lastWrittenRef.current
      if (Number.isFinite(last) && Math.abs(next - last) < TIME_EPSILON) return
      lastWrittenRef.current = next
      currentTime.set(next)
    },
    [currentTime],
  )

  // ① 播放中：rAF 逐帧读逐帧桥，取不到时回退 store
  useEffect(() => {
    if (!isPlaying) return

    let frame = 0
    const tick = () => {
      const frameTime = lyricPlayerBridge.getFrameTime()
      write(frameTime === null ? usePlayerStore.getState().currentTime : frameTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [isPlaying, write])

  // ② 暂停 / 拖动 / 切歌：store 一变就同步（也覆盖"起播前的首帧"）
  useEffect(() => {
    write(usePlayerStore.getState().currentTime)
    return usePlayerStore.subscribe((state, prev) => {
      if (state.currentTime !== prev.currentTime) write(state.currentTime)
    })
  }, [write])

  return { currentTime, isPlaying }
}
