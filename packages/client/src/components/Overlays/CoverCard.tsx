import { getDirectCoverUrl } from '@/lib/cover'
import { cn } from '@/lib/utils'
import { useState, type ReactNode } from 'react'

interface CoverArtProps {
  cover?: string
  fallback: ReactNode
  round?: boolean
  className?: string
}

function CoverArt({ cover, fallback, round, className }: CoverArtProps) {
  const [failed, setFailed] = useState(false)
  const src = cover && !failed ? getDirectCoverUrl(cover) : ''
  return (
    <div className={cn('bg-muted relative shrink-0 overflow-hidden', round ? 'rounded-full' : 'rounded-lg', className)}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
        />
      ) : (
        <div className="flex size-full items-center justify-center">{fallback}</div>
      )}
    </div>
  )
}

interface CoverItemProps {
  title: string
  subtitle?: string
  cover?: string
  fallback: ReactNode
  round?: boolean
  onClick: () => void
}

/** 歌单、专辑、歌手的封面卡片：方形封面（歌手为圆形）+ 标题。 */
export function CoverCard({ title, subtitle, cover, fallback, round, onClick }: CoverItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group hover:bg-accent/50 flex w-full min-w-0 flex-col gap-2 rounded-xl p-2 text-left transition-colors"
    >
      <CoverArt cover={cover} fallback={fallback} round={round} className="aspect-square w-full" />
      <div className={cn('min-w-0 px-0.5', round && 'text-center')}>
        <p className="line-clamp-2 text-sm leading-snug">{title}</p>
        {subtitle ? <p className="text-muted-foreground mt-0.5 truncate text-xs">{subtitle}</p> : null}
      </div>
    </button>
  )
}

export function CoverGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-5">{children}</div>
}

/** 单行列表项：小封面 + 标题 + 一行说明。 */
export function CollectionRow({ title, subtitle, cover, fallback, round, onClick }: CoverItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group hover:bg-accent/50 flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left transition-colors"
    >
      <CoverArt cover={cover} fallback={fallback} round={round} className={cn('size-12', !round && 'rounded-md')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle ? <p className="text-muted-foreground truncate text-xs">{subtitle}</p> : null}
      </div>
    </button>
  )
}
