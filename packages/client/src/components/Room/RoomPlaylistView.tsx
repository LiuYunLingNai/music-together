import { QueueTrackCover } from '@/components/Room/QueueTrackCover'
import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import type { MusicSource, Track } from '@music-together/shared'

const SOURCE_STYLE: Record<MusicSource, { label: string; className: string }> = {
  netease: { label: '网易', className: 'bg-red-500 text-white' },
  tencent: { label: 'QQ', className: 'bg-green-500 text-white' },
  kugou: { label: '酷狗', className: 'bg-blue-500 text-white' },
  kugou_concept: { label: '概念版', className: 'bg-sky-500 text-white' },
  bilibili: { label: 'B站', className: 'bg-pink-500 text-white' },
}

interface RoomPlaylistViewProps {
  queue: Track[]
  currentTrackId?: string
}

export function RoomPlaylistView({ queue, currentTrackId }: RoomPlaylistViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-white/90">房间歌单</h2>
          <p className="mt-1 text-xs text-white/45">{queue.length} 首歌曲</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {queue.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/45">播放列表为空</div>
        ) : (
          <div className="space-y-1">
            {queue.map((track, index) => {
              const active = track.id === currentTrackId
              const sourceStyle = SOURCE_STYLE[track.source]
              return (
                <div
                  key={track.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                    active ? 'bg-primary/15 text-primary' : 'text-white/80 hover:bg-white/5',
                  )}
                >
                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-white/35">{index + 1}</span>
                  <QueueTrackCover track={track} className="h-11 w-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <MarqueeText className={cn('text-sm', active && 'font-medium')}>{track.title}</MarqueeText>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-white/45">
                      <span className="truncate">{track.artist.join(' / ') || '未知歌手'}</span>
                      {sourceStyle && (
                        <span className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] leading-none', sourceStyle.className)}>
                          {sourceStyle.label}
                        </span>
                      )}
                    </div>
                  </div>
                  {active && <span className="shrink-0 text-xs text-primary">正在播放</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
