import { cn } from '@/lib/utils'
import {
  animate,
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
  type PanInfo,
} from 'motion/react'
import { useEffect, useRef } from 'react'

const MAX_HEIGHT = 20
const MIN_HEIGHT = 8
const INITIAL_INSET = (MAX_HEIGHT - MIN_HEIGHT) / 2
const MAX_BOUNCE_DISTANCE = 12
const KEY_STEP_RATIO = 0.02

interface BouncingSliderProps {
  /** 房间时间线上的当前位置（秒）。 */
  value: number
  max: number
  isPlaying: boolean
  disabled?: boolean
  /** 过渡期间：本体随节拍缓慢呼吸（粗细与亮度）；结束时平滑回落，不会瞬间跳回。 */
  breathing?: boolean
  breathPeriodSec?: number
  className?: string
  /** 拖动中的本地预览；只用于显示，不得当作权威进度。 */
  onPreview: (time: number) => void
  onSeeking: (seeking: boolean) => void
  /** 松手或点击时提交一次；房间同步由调用方走服务端 Seek。 */
  onCommit: (time: number) => void
}

/** 对齐上游 AMLL BouncingSlider：悬停变粗、拖出两端时整条弹性回弹。 */
export function BouncingSlider({
  value,
  max,
  isPlaying,
  disabled = false,
  breathing = false,
  breathPeriodSec = 2.4,
  className,
  onPreview,
  onSeeking,
  onCommit,
}: BouncingSliderProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const hoveringRef = useRef(false)
  const draggingRef = useRef(false)
  const localTimeRef = useRef(value)

  const progress = useMotionValue(0)
  const inset = useMotionValue(INITIAL_INSET)
  const clipPath = useMotionTemplate`inset(${inset}px 0px round 100px)`
  const bounceX = useSpring(0, { damping: 12, stiffness: 300 })

  // 呼吸：0..1 的相位驱动本体粗细（scaleY）与填充亮度；退出时用同一个值平滑回到 0。
  const breath = useMotionValue(0)
  const barScaleY = useTransform(breath, [0, 1], [1, 1.3])
  const fillOpacity = useTransform(breath, [0, 1], [0.4, 0.55])
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!breathing || reduce) {
      const settle = animate(breath, 0, { duration: 0.6, ease: 'easeOut' })
      return () => settle.stop()
    }
    const loop = animate(breath, [0, 1, 0], { duration: breathPeriodSec, ease: 'easeInOut', repeat: Infinity })
    return () => loop.stop()
  }, [breathing, breathPeriodSec, breath])

  const toProgress = (t: number) => (max > 0 ? Math.max(0, Math.min(1, t / max)) : 0)

  // 房间时钟（约 10Hz）到达即覆盖本地外推，外推只负责两次更新之间的平滑。
  useEffect(() => {
    if (draggingRef.current) return
    localTimeRef.current = value
    progress.set(toProgress(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, max, progress])

  useAnimationFrame((_t, delta) => {
    if (!isPlaying || draggingRef.current || max <= 0) return
    localTimeRef.current = Math.min(max, localTimeRef.current + delta / 1000)
    progress.set(toProgress(localTimeRef.current))
  })

  const expand = () => {
    animate(inset, 0, { type: 'tween', ease: 'easeOut', duration: 0.28 })
  }
  const collapse = () => {
    animate(inset, INITIAL_INSET, { type: 'spring', damping: 12, stiffness: 200 })
  }

  const positionOf = (info: PanInfo, rect: DOMRect) => (info.point.x - rect.left) / rect.width

  const handlePanStart = () => {
    if (disabled || max <= 0) return
    draggingRef.current = true
    rectRef.current = innerRef.current?.getBoundingClientRect() ?? null
    expand()
    onSeeking(true)
  }

  const handlePan = (_e: unknown, info: PanInfo) => {
    const rect = rectRef.current
    if (!draggingRef.current || !rect) return
    const rel = positionOf(info, rect)
    if (rel < 0) bounceX.set(Math.tanh(rel * 2) * MAX_BOUNCE_DISTANCE)
    else if (rel > 1) bounceX.set(Math.tanh((rel - 1) * 2) * MAX_BOUNCE_DISTANCE)
    else bounceX.set(0)
    const clamped = Math.max(0, Math.min(1, rel))
    localTimeRef.current = clamped * max
    progress.set(clamped)
    onPreview(localTimeRef.current)
  }

  const handlePanEnd = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    rectRef.current = null
    if (hoveringRef.current) expand()
    else collapse()
    bounceX.set(0)
    onSeeking(false)
    onCommit(localTimeRef.current)
  }

  const handleTap = (_e: unknown, info: PanInfo) => {
    if (disabled || max <= 0) return
    const rect = innerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const clamped = Math.max(0, Math.min(1, positionOf(info, rect)))
    localTimeRef.current = clamped * max
    progress.set(clamped)
    onCommit(localTimeRef.current)
  }

  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
    },
    [],
  )

  // 长按方向键会连发：本地累加并预览，停手 300ms 后只向房间提交一次，避免撞上事件限流。
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || max <= 0) return
    const step = max * KEY_STEP_RATIO
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(max, localTimeRef.current + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, localTimeRef.current - step)
    else return
    e.preventDefault()
    if (!draggingRef.current) {
      draggingRef.current = true
      onSeeking(true)
    }
    localTimeRef.current = next
    progress.set(toProgress(next))
    onPreview(next)
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
    keyTimerRef.current = setTimeout(() => {
      keyTimerRef.current = null
      draggingRef.current = false
      onSeeking(false)
      onCommit(localTimeRef.current)
    }, 300)
  }

  return (
    <motion.div
      role="slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex min-h-6 w-full touch-none items-center [transform:translateZ(0)]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
      style={{ x: bounceX }}
      onPanStart={handlePanStart}
      onPan={handlePan}
      onPanEnd={handlePanEnd}
      onTap={handleTap}
      onHoverStart={() => {
        hoveringRef.current = true
        if (!draggingRef.current && !disabled) expand()
      }}
      onHoverEnd={() => {
        hoveringRef.current = false
        if (!draggingRef.current) collapse()
      }}
    >
      <motion.div ref={innerRef} className="h-5 w-full flex-1 bg-white/15" style={{ clipPath, scaleY: barScaleY }}>
        <motion.div className="h-full w-full bg-white" style={{ scaleX: progress, originX: 0, opacity: fillOpacity }} />
      </motion.div>
    </motion.div>
  )
}
