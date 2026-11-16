import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'

export type CoverFrameStyle = {
  width: number
  height: number
  left: number
  top: number
  borderRadius: number
}

const BIG_RADIUS = 24
const SMALL_RADIUS = 8
/** 控件宽度跟随封面宽度时，控件高度会反向影响可用高度；忽略亚像素回差避免来回抖。 */
const DEAD_ZONE_PX = 1.5

interface PortraitCoverFrameOptions {
  lyricExpanded: boolean
  immersive: boolean
  /** 竖屏舞台才需要封面帧；切换布局时重新挂载观察目标。 */
  enabled: boolean
  /** 舞台列容器：封面帧以它为定位原点。 */
  rootRef: RefObject<HTMLDivElement | null>
}

/**
 * 竖屏封面的单节点布局，对齐上游 `VerticalLayout`：
 * 封面只保留一个持久节点，布局里放一个不可见占位块，测量占位块后动画 `left/top/width/height`。
 * 换歌只换封面内容，不参与布局动画，因此不会出现上一首的封面或文字。
 */
export function usePortraitCoverFrame({ lyricExpanded, immersive, enabled, rootRef }: PortraitCoverFrameOptions) {
  const bigSlotRef = useRef<HTMLDivElement | null>(null)
  const smallSlotRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<CoverFrameStyle | null>(null)
  const [frame, setFrame] = useState<CoverFrameStyle | null>(null)

  const measure = useCallback(() => {
    if (!enabled) return
    const root = rootRef.current
    const slot = lyricExpanded ? smallSlotRef.current : bigSlotRef.current
    if (!root || !slot) return

    const rootRect = root.getBoundingClientRect()
    const slotRect = slot.getBoundingClientRect()
    if (slotRect.width <= 0 || slotRect.height <= 0) return

    const left = slotRect.left - rootRect.left
    const top = slotRect.top - rootRect.top
    let size: number
    if (immersive && !lyricExpanded) {
      // 上游沉浸公式：从舞台顶部到占位中心的高度放大 2.4 倍，至少盖满整个舞台。
      const halfHeight = top + slotRect.height / 2
      size = Math.max(halfHeight * 2.4, rootRect.width * 1.2, Math.min(slotRect.width, slotRect.height))
    } else {
      size = Math.min(slotRect.width, slotRect.height)
    }

    const next: CoverFrameStyle = {
      width: Math.round(size * 10) / 10,
      height: Math.round(size * 10) / 10,
      left: Math.round((left + (slotRect.width - size) / 2) * 10) / 10,
      top: Math.round((top + (slotRect.height - size) / 2) * 10) / 10,
      borderRadius: lyricExpanded ? SMALL_RADIUS : BIG_RADIUS,
    }

    const prev = frameRef.current
    if (
      prev &&
      prev.borderRadius === next.borderRadius &&
      Math.abs(prev.width - next.width) <= DEAD_ZONE_PX &&
      Math.abs(prev.height - next.height) <= DEAD_ZONE_PX &&
      Math.abs(prev.left - next.left) <= DEAD_ZONE_PX &&
      Math.abs(prev.top - next.top) <= DEAD_ZONE_PX
    ) {
      return
    }

    frameRef.current = next
    setFrame(next)
  }, [enabled, immersive, lyricExpanded, rootRef])

  useLayoutEffect(() => {
    measure()

    const observed = [rootRef.current, bigSlotRef.current, smallSlotRef.current].filter(
      (node): node is HTMLDivElement => node !== null,
    )
    const observer = new ResizeObserver(measure)
    for (const node of observed) observer.observe(node)

    const handleResize = () => measure()
    window.addEventListener('resize', handleResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [measure, rootRef])

  return { frame: enabled ? frame : null, bigSlotRef, smallSlotRef }
}
