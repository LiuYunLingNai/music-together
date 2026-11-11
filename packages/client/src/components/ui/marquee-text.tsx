import { cn } from '@/lib/utils'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface MarqueeTextProps {
  children: ReactNode
  className?: string
}

/**
 * Text component that automatically scrolls horizontally when content overflows.
 * Uses CSS `translateX` animation (GPU-accelerated) with pause-scroll-pause pattern.
 * Falls back to static display when text fits within the container.
 */
export function MarqueeText({ children, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return

    const check = () => {
      const diff = text.scrollWidth - container.clientWidth
      setOverflow(diff > 1 ? diff : 0)
    }

    check()

    const ro = new ResizeObserver(check)
    ro.observe(container)
    ro.observe(text)

    return () => ro.disconnect()
    // 同时观察容器与文字尺寸即可覆盖内容与宽度变化；元素型 children 每次渲染都是新对象，不能作为依赖。
  }, [])

  const duration = overflow > 0 ? Math.max(5, 4 + overflow / 30) : 0

  return (
    <div ref={containerRef} className={cn('overflow-hidden', className)}>
      <span
        ref={textRef}
        className={cn('inline-block whitespace-nowrap', overflow > 0 && 'animate-marquee will-change-transform')}
        style={
          overflow > 0
            ? ({
                '--marquee-distance': `-${overflow + 8}px`,
                animationDuration: `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </span>
    </div>
  )
}
