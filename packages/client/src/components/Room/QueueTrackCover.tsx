import { getDirectCoverUrl, getProxiedCoverUrl } from '@/lib/cover'
import { cn } from '@/lib/utils'
import type { Track } from '@music-together/shared'
import { Music } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

interface QueueTrackCoverProps {
  track: Track
  className?: string
  iconClassName?: string
}

/** Queue artwork that falls back from the small CDN image to the full cover. */
export const QueueTrackCover = memo(function QueueTrackCover({
  track,
  className,
  iconClassName,
}: QueueTrackCoverProps) {
  const candidates = useMemo(
    () => {
      const direct = [track.thumbnailCover, track.cover]
        .filter((value): value is string => Boolean(value))
        .map(getDirectCoverUrl)
      // Normal <img> rendering does not require CORS, so prefer the direct CDN
      // URL. The server proxy remains a fallback for providers that reject the
      // browser request; direct loading also avoids unnecessary server traffic
      // when a long queue is loaded all at once.
      return [...new Set([...direct, ...direct.map(getProxiedCoverUrl)])]
    },
    [track.cover, track.thumbnailCover],
  )
  const candidateKey = `${track.id}:${candidates.join('|')}`

  return (
    <QueueTrackCoverImage
      key={candidateKey}
      candidates={candidates}
      title={track.title}
      className={className}
      iconClassName={iconClassName}
    />
  )
})

interface QueueTrackCoverImageProps {
  candidates: string[]
  title: string
  className?: string
  iconClassName?: string
}

function QueueTrackCoverImage({ candidates, title, className, iconClassName }: QueueTrackCoverImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0)

  const coverUrl = candidates[candidateIndex]
  if (!coverUrl) {
    return (
      <div className={cn('flex items-center justify-center rounded bg-muted', className)}>
        <Music className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />
      </div>
    )
  }

  return (
    <img
      src={coverUrl}
      alt={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn('rounded object-cover', className)}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  )
}
