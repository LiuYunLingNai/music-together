import { useContext, useEffect } from 'react'
import { AbilityContext } from '@/providers/ability-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import type { MotionValue } from 'motion/react'
import type { VoteAction } from '@music-together/shared'

/** JIZURA asks for room actions; it never owns a second audio clock. */
export function useKineticTransport(
  currentTime: MotionValue<number>,
  onPlay: () => void,
  onPause: () => void,
  onLyricSeek: (time: number) => void,
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void,
) {
  const ability = useContext(AbilityContext)
  useEffect(() => {
    let last = -Infinity
    const publish = (time: number) => {
      if (Math.abs(time - last) < 0.2) return
      last = time
      window.dispatchEvent(new CustomEvent('kinetic:time', { detail: { time } }))
    }
    publish(currentTime.get())
    const unsubscribe = currentTime.on('change', publish)
    const seek = (event: Event) => {
      const value = (event as CustomEvent<{ time?: unknown }>).detail?.time
      if (typeof value !== 'number' || !Number.isFinite(value) || !ability.can('seek', 'Player')) return
      const state = usePlayerStore.getState()
      const key = getLyricOffsetKey(state.currentTrack)
      const offset = state.lyricOffsetPreview?.key === key ? state.lyricOffsetPreview.offsetMs
        : useSettingsStore.getState().lyricOffsets[key ?? ''] ?? 0
      const position = value + offset / 1000
      onLyricSeek(Math.max(0, Math.min(state.duration || position, position)))
    }
    const toggle = (event: Event) => {
      const requested = (event as CustomEvent<{ playing?: unknown }>).detail?.playing
      const playing = usePlayerStore.getState().isPlaying
      const next = typeof requested === 'boolean' ? requested : !playing
      if (next === playing || !usePlayerStore.getState().currentTrack) return
      if (ability.can('play', 'Player')) { if (next) onPlay(); else onPause() }
      else if (ability.can('vote', 'Player')) onStartVote(next ? 'resume' : 'pause')
    }
    window.addEventListener('kinetic:seek', seek)
    window.addEventListener('kinetic:toggle-play', toggle)
    return () => {
      unsubscribe()
      window.removeEventListener('kinetic:seek', seek)
      window.removeEventListener('kinetic:toggle-play', toggle)
    }
  }, [ability, currentTime, onPlay, onPause, onLyricSeek, onStartVote])
}
