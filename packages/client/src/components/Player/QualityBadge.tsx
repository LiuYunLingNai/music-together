import type { AudioQuality } from '@music-together/shared'
import { getAudioQualityBadgeTooltip, getShortAudioQualityLabel, isLosslessAudioQuality } from '@/lib/audioQuality'
import { cn } from '@/lib/utils'

export interface QualityBadgeProps {
  /** 服务端解析到的实际音质；未知时回退到码率。 */
  quality?: AudioQuality | null
  bitrate?: number | null
  downgraded?: boolean
  /** 房间请求档位，用于 tooltip 里的“期望 vs 实际”。 */
  requested?: AudioQuality | null
  className?: string
}

/**
 * 当前播放音质标签。只展示服务端实际解析到的档位，不用房间设置冒充实际；
 * 两者不一致时加一个降级箭头，详细说明放在原生 title 里。
 */
export function QualityBadge({ quality, bitrate, downgraded, requested, className }: QualityBadgeProps) {
  const label = getShortAudioQualityLabel(quality, bitrate)
  if (!label) return null

  const lossless = isLosslessAudioQuality(quality, bitrate)
  const tooltip = getAudioQualityBadgeTooltip({ quality, bitrate, downgraded, requested })

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'inline-flex shrink-0 select-none items-center gap-0.5 rounded px-1 text-[10px] font-semibold leading-4',
        lossless ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-white/60',
        className,
      )}
    >
      {label}
      {downgraded && (
        <span aria-hidden className="text-amber-400">
          ↓
        </span>
      )}
    </span>
  )
}
