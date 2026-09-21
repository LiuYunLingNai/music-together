import { getProxiedCoverUrl } from '@/lib/cover'
import { usePlayerStore } from '@/stores/playerStore'
import { useEffect, useRef, useState } from 'react'

interface AmbientBackdropProps {
  /** 封面主色，用于渐变基调 */
  accent: string | null
  /** 低画质档：跳过昂贵的模糊铺底 */
  lowQuality?: boolean
}

/**
 * 舞台环境底色层。
 *
 * 这是画布**之下**的一层，用来避免整个舞台退化成纯黑。
 * 上游两个项目都有这一层：
 *
 * - Mineradio `#album-bg`：封面放大模糊铺底
 *     filter: blur(120px) brightness(0.18) saturate(1.5)
 *     transform: scale(1.4)
 * - OpenMusic `RoomAmbientBackground`：颜色/图片环境层
 *
 * 之前的实现在没有自定义背景时直接返回 null，且画布不透明，
 * 于是整块区域没有任何色彩，看起来"全是黑的"。这里补上。
 */
export function AmbientBackdrop({ accent, lowQuality = false }: AmbientBackdropProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const coverUrl = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : null

  // 当前已解码完成的封面；只在新图真正 onload 后才切换，避免切歌闪黑
  const [activeCover, setActiveCover] = useState<string | null>(null)
  // 上一张封面，用于交叉淡出
  const [fadingCover, setFadingCover] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!coverUrl) return

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      if (cancelled) return
      const previous = activeRef.current
      if (previous && previous !== coverUrl) setFadingCover(previous)
      activeRef.current = coverUrl
      setActiveCover(coverUrl)
    }
    image.onerror = () => {
      // 封面取不到时保留基色渐变，不清空为纯黑
      if (cancelled) return
      activeRef.current = null
      setActiveCover(null)
    }
    image.src = coverUrl

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  // 没有封面时（切歌到无封面的曲目）清空铺底，回退到基色渐变。
  // 派生值而非在 effect 中同步 setState，避免级联渲染。
  const showCover = coverUrl ? activeCover : null

  const tint = accent ?? '#2c4a72'

  return (
    <div className="mt-mineradio-ambient" aria-hidden="true">
      {/* 1. 基色渐变：任何时候都有色彩层次，而不是纯黑 */}
      <div className="mt-mineradio-ambient__base" style={{ ['--mt-ambient-tint' as string]: tint }} />

      {/* 2. 上一张封面：交叉淡出，避免切歌瞬间闪黑 */}
      {showCover && fadingCover && fadingCover !== showCover && (
        <div
          className="mt-mineradio-ambient__cover mt-mineradio-ambient__cover--prev"
          style={{ backgroundImage: `url("${fadingCover}")` }}
          onTransitionEnd={() => setFadingCover(null)}
        />
      )}

      {/* 3. 封面放大模糊铺底（Mineradio #album-bg 同款处理） */}
      {showCover && !lowQuality && (
        <div className="mt-mineradio-ambient__cover" style={{ backgroundImage: `url("${showCover}")` }} />
      )}

      {/* 4. 暗角：压住四角，让粒子与歌词主体突出 */}
      <div className="mt-mineradio-ambient__vignette" />
    </div>
  )
}
