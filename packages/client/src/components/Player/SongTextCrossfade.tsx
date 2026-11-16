import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

/** 与封面同一段节奏：旧字轻轻上飘淡出，新字从下方 6px 归位。 */
const DURATION = 0.5
const EASE: [number, number, number, number] = [0.37, 0, 0.63, 1]

interface SongTextCrossfadeProps {
  text: string
  /** 同一行文字的上一条；null 表示首帧或无需交接。 */
  from: string | null
  token: number
  /** 当前文字的可交互渲染（如可点击的歌手名）；交接动画的旧字仍用纯文本。 */
  content?: ReactNode
  className?: string
}

export function SongTextCrossfade({ text, from, token, content, className }: SongTextCrossfadeProps) {
  const progress = useMotionValue(1)
  const incomingOpacity = progress
  const incomingY = useTransform(progress, (v) => (1 - v) * 6)
  const outgoingOpacity = useTransform(progress, (v) => 1 - v)
  const outgoingY = useTransform(progress, (v) => -(1 - v) * 4)

  const crossing = from !== null && from !== text
  // 只对挂载之后发生的换歌做过渡：`from` 会一直保留上一首，
  // 组件晚挂载（展开歌词视图）时不能拿它再演一遍旧标题。
  const animatedToken = useRef(token)

  useLayoutEffect(() => {
    progress.set(1)
    if (animatedToken.current === token) return
    animatedToken.current = token
    if (!crossing || !useSettingsStore.getState().songHandoffAnimation) return
    if (typeof window === 'undefined' || window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches) return
    progress.set(0)
    const animation = animate(progress, 1, { duration: DURATION, ease: EASE })
    return () => animation.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className={cn('relative min-w-0', className)}>
      <motion.div style={{ opacity: crossing ? incomingOpacity : 1, y: crossing ? incomingY : 0 }}>
        <MarqueeText>{content ?? text}</MarqueeText>
      </motion.div>
      {crossing && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ opacity: outgoingOpacity, y: outgoingY }}
        >
          <MarqueeText>{from}</MarqueeText>
        </motion.div>
      )}
    </div>
  )
}
