import { useState } from 'react'
import type { Track } from '@music-together/shared'
import { usePlayerStore } from '@/stores/playerStore'

export interface SongHandoff {
  /** 上一首（首帧或尚未换过歌时为 null）。 */
  from: Track | null
  to: Track | null
  /** 每次真实换歌加一；首帧挂载为 0，动画靠它重启。 */
  token: number
}

/**
 * 换歌交接快照。`useHowl` 在混合开始的那一刻就把 `currentTrack` 换成入歌，
 * 所以这里跟着 store 的每一次换曲同步前后两首，视觉与音频同刻切换。
 * App 首次拿到歌曲不触发（from 为 null），避免进门就播一遍。
 */
export function useSongHandoff(): SongHandoff {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const [handoff, setHandoff] = useState<SongHandoff>(() => ({ from: null, to: currentTrack, token: 0 }))

  // 渲染期派生而不是 effect：store 换曲与这次渲染必须落在一起，
  // 放到 effect 里会在新曲已画出、旧曲快照尚未更新时露出半帧。
  if (handoff.to?.id !== currentTrack?.id) {
    setHandoff({ from: handoff.to, to: currentTrack, token: handoff.token + 1 })
  } else if (handoff.to !== currentTrack) {
    // 同一首的字段更新（歌词 / 元数据）：只换引用，不重播过渡。
    setHandoff({ ...handoff, to: currentTrack })
  }

  return handoff
}
