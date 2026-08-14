import type { Howl } from 'howler'

interface Html5Sound {
  _id: number
  _node?: { currentTime: number }
  _seek?: number
  _rateSeek?: number
}

/**
 * Move a playing HTML5 Howl without Howler's pause/seek/play cycle. Mobile
 * browsers can otherwise add enough latency to immediately recreate drift.
 */
export function setHowlPosition(howl: Howl, targetTime: number, soundId?: number): void {
  const safeTarget = Math.max(0, targetTime)
  const internal = howl as unknown as { _sounds?: Html5Sound[] }
  const sound = internal._sounds?.find((candidate) => soundId === undefined || candidate._id === soundId)

  if (howl.playing(soundId) && sound?._node && Number.isFinite(sound._node.currentTime)) {
    try {
      sound._node.currentTime = safeTarget
      sound._seek = safeTarget
      sound._rateSeek = safeTarget
      return
    } catch {
      // Some media implementations reject a seek before metadata is ready.
    }
  }

  if (soundId === undefined) howl.seek(safeTarget)
  else howl.seek(safeTarget, soundId)
}
