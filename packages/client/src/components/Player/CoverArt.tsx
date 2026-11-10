import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@music-together/shared'
import { Disc3 } from 'lucide-react'
import { motion } from 'motion/react'
import { getDirectCoverUrl } from '@/lib/cover'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

/** 换歌时新封面淡入的时长，与 AMLL mesh 背景换图同一段呼吸。 */
const CROSSFADE_SEC = 0.5
const EASE: [number, number, number, number] = [0.37, 0, 0.63, 1]

/** 接缝交叉淡化时长：动态封面循环点固定取结尾 10% 以内的一小段。 */
const SEAM_FADE_SEC = 0.4

/**
 * 动态封面的首尾帧常常不衔接，直接 loop 会硬切。用两个同源 video 轮换：
 * 结尾前 0.4s 淡入从 0 点开始播放的另一份、淡出当前这份，保留播放方向。
 */
function LoopingVideo({ src, onReady, onError }: { src: string; onReady: () => void; onError: () => void }) {
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const [active, setActive] = useState(0)
  const [previous, setPrevious] = useState<number | null>(null)
  const activeRef = useRef(0)
  const previousRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const switchToOther = useCallback(() => {
    if (!mountedRef.current) return
    const prev = activeRef.current
    if (previousRef.current !== null) return
    const next = prev === 0 ? 1 : 0
    const incoming = videos.current[next]
    if (!incoming) return

    let activated = false
    let fallback = 0
    const activate = () => {
      if (activated || !mountedRef.current) return
      activated = true
      if (activeRef.current === next) return
      window.clearTimeout(fallback)
      activeRef.current = next
      previousRef.current = prev
      setActive(next)
      setPrevious(prev)
      // 淡出结束：旧视频降到最底层并停掉解码。
      window.setTimeout(() => {
        if (!mountedRef.current) return
        const outgoing = videos.current[prev]
        if (outgoing && activeRef.current !== prev) outgoing.pause()
        previousRef.current = null
        setPrevious(null)
      }, SEAM_FADE_SEC * 1000 + 60)
    }

    try {
      incoming.currentTime = 0
    } catch {
      // 元数据尚未就绪时下一帧会再试。
    }
    // 等新视频真正渲染出一帧再交换不透明度：否则会在淡入的 0.4s 里
    // 露出底下的静态封面（两路 video 各 50% 透明时覆盖不满）。
    if (typeof incoming.requestVideoFrameCallback === 'function') {
      incoming.requestVideoFrameCallback(() => activate())
    } else {
      incoming.addEventListener('seeked', () => activate(), { once: true })
    }
    // rVFC 在后台标签页可能停摆；轮询到有可显示帧再接手，最多等约 480ms。
    let attempts = 0
    const waitForFrame = () => {
      if (activated || !mountedRef.current) return
      if (incoming.readyState >= 2 || attempts >= 8) {
        activate()
        return
      }
      attempts += 1
      fallback = window.setTimeout(waitForFrame, 60)
    }
    fallback = window.setTimeout(waitForFrame, 60)
    void incoming.play().catch(() => undefined)
  }, [])

  // 逐帧盯住接缝；后台标签页里 rVFC 可能停摆，所以 ended 里再兜一次。
  useEffect(() => {
    const video = videos.current[active]
    if (!video) return

    let frame = 0
    let timer = 0
    let switched = false
    const schedule = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        frame = video.requestVideoFrameCallback(check)
      } else {
        timer = window.setTimeout(check, 120)
      }
    }
    const check = () => {
      if (switched) return
      const duration = video.duration
      if (Number.isFinite(duration) && duration > SEAM_FADE_SEC * 2 && video.currentTime >= duration - SEAM_FADE_SEC) {
        switched = true
        switchToOther()
        return
      }
      schedule()
    }
    schedule()

    return () => {
      video.cancelVideoFrameCallback?.(frame)
      window.clearTimeout(timer)
    }
  }, [active, switchToOther])

  const markReady = useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    onReady()
  }, [onReady])

  return (
    <>
      {[0, 1].map((index) => {
        const isActive = index === active
        const isPrevious = index === previous
        return (
          <video
            key={index}
            ref={(node) => {
              videos.current[index] = node
            }}
            src={src}
            autoPlay={index === 0}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            aria-hidden
            onPlaying={(event) => {
              const video = event.currentTarget
              if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(() => markReady())
              } else {
                markReady()
              }
            }}
            onTimeUpdate={markReady}
            onError={onError}
            onEnded={() => {
              if (index === activeRef.current) {
                switchToOther()
                return
              }
              if (previousRef.current === index) return
              const video = videos.current[index]
              if (video) video.currentTime = 0
            }}
            className={cn(
              'absolute inset-0 h-full w-full object-cover',
              isPrevious ? 'opacity-0' : 'opacity-100',
            )}
            style={{
              transitionProperty: 'opacity',
              transitionTimingFunction: 'linear',
              transitionDuration: isPrevious ? `${SEAM_FADE_SEC * 1000}ms` : '0ms',
              // 淡出的一路压在最上面；新一路始终不透明地垫在下面，静态封面不会透出来。
              zIndex: isPrevious ? 2 : isActive ? 1 : 0,
            }}
          />
        )
      })}
    </>
  )
}

interface CoverArtProps {
  track: Track | null
  /** 动态封面（视频封面）；小封面传 null 以省掉视频解码。 */
  videoUrl?: string | null
}

/**
 * 封面内容只跟随当前曲目。旧封面留在底层，新封面加载完成后淡入覆盖：
 * 连续切歌时始终有一张已就绪的图在画面上，不会闪白，也不会把上一首的图层带进形变。
 */
export function CoverArt({ track, videoUrl = null }: CoverArtProps) {
  const src = track?.cover ? getDirectCoverUrl(track.cover) : null
  const handoffEnabled = useSettingsStore((s) => s.songHandoffAnimation)
  const [baseSrc, setBaseSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [readyVideoUrl, setReadyVideoUrl] = useState<string | null>(null)
  const srcRef = useRef(src)
  useEffect(() => {
    srcRef.current = src
  }, [src])

  const incomingSrc = src && src !== baseSrc && src !== failedSrc ? src : null
  const incomingReady = incomingSrc !== null && loadedSrc === incomingSrc
  const videoReady = videoUrl !== null && readyVideoUrl === videoUrl
  // 快速连续切歌时，上一张已经加载完成的封面可以直接当底层：
  // 不能等 0.5s 淡入结束才提升，否则会短暂露出更早的那张。
  const latestLoadedSrc =
    loadedSrc && loadedSrc !== src && failedSrc !== loadedSrc ? loadedSrc : null
  // 新曲无封面或封面加载失败时不能留着底层旧图，否则会一直显示上一首的封面。
  const visibleBaseSrc = src && failedSrc !== src ? (latestLoadedSrc ?? baseSrc) : null

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const fadeDuration = handoffEnabled && !reducedMotion ? CROSSFADE_SEC : 0

  const layerSrcs = [visibleBaseSrc, incomingSrc].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-secondary">
      {layerSrcs.length === 0 && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center">
          <Disc3 className="h-1/3 w-1/3 text-white/20" />
        </div>
      )}

      {layerSrcs.map((layerSrc) => {
        const isIncoming = layerSrc === incomingSrc
        return (
          <motion.img
            key={layerSrc}
            src={layerSrc}
            alt={isIncoming ? (track?.title ?? '') : ''}
            referrerPolicy="no-referrer"
            draggable={false}
            initial={isIncoming ? { opacity: 0 } : false}
            animate={{ opacity: isIncoming ? (incomingReady ? 1 : 0) : 1 }}
            transition={{ duration: fadeDuration, ease: EASE }}
            onLoad={() => {
              // 快速切歌后旧 <img> 仍可能触发 load；只接受当前 src 的结果。
              if (srcRef.current !== layerSrc) return
              setLoadedSrc(layerSrc)
              if (fadeDuration === 0) setBaseSrc(layerSrc)
            }}
            onError={() => {
              if (srcRef.current !== layerSrc) return
              setFailedSrc(layerSrc)
            }}
            onAnimationComplete={() => {
              if (isIncoming && srcRef.current === layerSrc && loadedSrc === layerSrc) {
                setBaseSrc(layerSrc)
              }
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )
      })}

      {videoUrl && (
        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-500',
            videoReady ? 'opacity-100' : 'opacity-0',
          )}
        >
          <LoopingVideo
            key={videoUrl}
            src={videoUrl}
            onReady={() => setReadyVideoUrl(videoUrl)}
            onError={() => setReadyVideoUrl(null)}
          />
        </div>
      )}
    </div>
  )
}
