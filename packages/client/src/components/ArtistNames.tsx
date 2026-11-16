import { hasArtistPages, isRealArtistName, trackArtists } from '@/lib/artistLink'
import { cn } from '@/lib/utils'
import { openArtistPage } from '@/stores/artistPageStore'
import type { Track } from '@music-together/shared'

interface ArtistNamesProps {
  track: Pick<Track, 'source' | 'artist' | 'artistIds'>
  /** 平台没有歌手页时的替代行为（例如按名字搜索）；不传则显示纯文本。 */
  onUnsupportedClick?: (name: string) => void
  className?: string
}

/** 曲目的歌手名「A / B」，每个名字都能打开对应歌手页。 */
export function ArtistNames({ track, onUnsupportedClick, className }: ArtistNamesProps) {
  const supported = hasArtistPages(track.source)
  return (
    <>
      {trackArtists(track).map((artist, index) => {
        const open = !isRealArtistName(artist.name)
          ? undefined
          : supported
            ? () => openArtistPage(artist)
            : onUnsupportedClick && (() => onUnsupportedClick(artist.name))
        return (
          <span key={`${artist.name}-${index}`}>
            {index > 0 ? ' / ' : null}
            {open ? (
              <button
                type="button"
                className={cn(
                  'relative inline align-baseline hover:text-foreground hover:underline pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-2.5',
                  className,
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  open()
                }}
              >
                {artist.name}
              </button>
            ) : (
              artist.name
            )}
          </span>
        )
      })}
    </>
  )
}
