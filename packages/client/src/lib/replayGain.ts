import type { LoudnessInfo, ReplayGainMode } from '@/services/beatFx/offlineBeatAnalysis/loudness'
import {
  VOLUME_BALANCE_TARGET_DB,
  planBalanceMove,
  recordWholeTrackGain,
  replayGainDbFor,
} from './volumeBalance'
import { getActiveTransitionCue, transitionElapsedSec } from './automix/transitionCue'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { usePlayerStore } from '@/stores/playerStore'

/**
 * 当前曲目的响度增益。分析完成时发布，切歌/卸载时清空；音频图直接读这里。
 *
 * 宿主没有音源侧的 ReplayGain 标签，增益来自离线分析里顺带算出的积分响度。
 * 分析晚于开播时按上游 `planBalanceMove` 缓入：开播 10 s 内 2 s 斜坡，
 * 30 s 内且是明确压低的 5 s 斜坡，一次播放只动一次；过渡窗口内等它结束。
 */

type Listener = (linear: number, rampSec: number | null) => void

let currentLoudness: LoudnessInfo | null = null
const listeners = new Set<Listener>()

/** 本次播放已经应用过的增益，作为 `planBalanceMove.currentDb`。 */
let appliedDb = 0
/** 本次播放是否已经缓入过一次。 */
let moved = false
let holdTimer: ReturnType<typeof setTimeout> | null = null

const mode = (): ReplayGainMode => useAudioSettingsStore.getState().replayGainMode

/**
 * 本次播放已经出声的秒数（上游 `planBalanceMove.playSec` 的语义）。
 *
 * 不能用媒体位置：automix 从歌曲中段接入或用户 seek 后，位置一大，
 * 迟到的分析结果就会被判成"已经太晚"而永远不缓入。
 */
let playStartedAt = 0
let playTrackId: string | null = null

const playedSeconds = (): number =>
  playStartedAt > 0 ? Math.max(0, (performance.now() - playStartedAt) / 1000) : 0

const linearOf = (db: number): number => 10 ** (db / 20)

const notify = (rampSec: number | null): void => {
  const linear = linearOf(appliedDb)
  for (const listener of listeners) listener(linear, rampSec)
}

const cancelHold = (): void => {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
}

const applyMove = (nextDb: number, rampSec: number | null): void => {
  appliedDb = nextDb
  notify(rampSec)
}

/** 已应用的增益（线性）。返回 dB 会被直接写进 GainNode，`off` 时等于静音。 */
export const getReplayGainLinear = (): number => linearOf(appliedDb)

export const publishTrackLoudness = (loudness: LoudnessInfo | null | undefined): void => {
  if (!loudness) return
  currentLoudness = loudness
  recordWholeTrackGain(VOLUME_BALANCE_TARGET_DB - loudness.lufs)
  cancelHold()

  const nextDb = replayGainDbFor(currentLoudness, mode())
  if (mode() === 'off') {
    applyMove(0, null)
    return
  }
  const playSec = playedSeconds()
  const cue = getActiveTransitionCue()
  const move = planBalanceMove({
    playSec,
    moved,
    currentDb: appliedDb,
    nextDb,
    blendAudible: cue !== null,
  })

  if (move === 'set') {
    moved = false
    applyMove(nextDb, null)
  } else if (move === 'hold' && cue) {
    const remaining = Math.max(0, cue.seconds - transitionElapsedSec(cue))
    const holdTrackId = usePlayerStore.getState().currentTrack?.id
    holdTimer = setTimeout(() => {
      holdTimer = null
      // 过渡窗口里切了歌：这次缓入属于上一首，不能套到新曲上。
      if (usePlayerStore.getState().currentTrack?.id !== holdTrackId) return
      const after = planBalanceMove({
        playSec: usePlayerStore.getState().currentTime,
        moved,
        currentDb: appliedDb,
        nextDb,
        blendAudible: false,
      })
      if (after === 'set') {
        moved = false
        applyMove(nextDb, null)
      } else if (after && typeof after === 'object') {
        moved = true
        applyMove(nextDb, after.rampSec)
      }
    }, remaining * 1000)
  } else if (move && typeof move === 'object') {
    moved = true
    applyMove(nextDb, move.rampSec)
  }
}

export const clearTrackLoudness = (): void => {
  cancelHold()
  moved = false
  appliedDb = replayGainDbFor(null, mode())
  if (currentLoudness === null) return
  currentLoudness = null
  notify(null)
}

export const subscribeReplayGain = (listener: Listener): (() => void) => {
  listeners.add(listener)
  listener(linearOf(appliedDb), null)
  return () => {
    listeners.delete(listener)
  }
}

useAudioSettingsStore.subscribe((state, previous) => {
  if (state.replayGainMode === previous.replayGainMode) return
  cancelHold()
  moved = false
  appliedDb = replayGainDbFor(currentLoudness, mode())
  notify(null)
})

const initialPlayer = usePlayerStore.getState()
playTrackId = initialPlayer.currentTrack?.id ?? null
playStartedAt = initialPlayer.isPlaying ? performance.now() : 0

usePlayerStore.subscribe((state, previous) => {
  const id = state.currentTrack?.id ?? null
  if (id !== playTrackId) {
    playTrackId = id
    playStartedAt = state.isPlaying ? performance.now() : 0
  } else if (state.isPlaying && !previous.isPlaying) {
    playStartedAt = performance.now()
  } else if (!state.isPlaying && previous.isPlaying) {
    playStartedAt = 0
  }
})

export type { LoudnessInfo, ReplayGainMode }
