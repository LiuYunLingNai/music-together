import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { isFoliaModeId } from '@/components/Player/folia/registry'
import { BEAT_EFFECT_IDS, resolveBeatEffectSetting } from '@/services/beatFx/beatEffects'
import {
  beginBeatFxTrack,
  setBeatFxEvents,
  setBeatFxIntensities,
  setBeatFxLiveEffects,
  stopBeatFx,
} from '@/services/beatFx/beatFxLive'
import { currentBeatFxKey, loadBeatFxTrack } from '@/services/beatFx/beatFxSource'
import { liveBeatEffects, liveBeatEffectStrength, visualizerWantsBeats } from '@/services/beatFx/beatClockTargets'
import { smartBeatActive } from '@/services/beatFx/beatEffects'

/**
 * 把正在听的歌的拍点表装进实时时钟 —— 上游 `src/hooks/useBeatFxTrack.ts` 的宿主版本。
 *
 * 与上游的差异在于数据源：上游从 beat_this（Electron 主进程）取，这里从
 * `services/beatFx/offlineBeatAnalysis` 的离线拍点图换算（见 `beatFxSource`）。
 * 触发条件、强度下发、切歌重置的顺序与上游一致。
 *
 * 只有「歌曲身份 + 开关 + 强度」进入 React；逐帧的时钟在 `beatFxLive` 里。
 */
const RETRY_ATTEMPTS = 4
const RETRY_DELAY_MS = 3000

export function useBeatFxTrack(): boolean {
  const smartBeat = useSettingsStore((s) => s.smartBeat)
  const stage = useSettingsStore((s) => s.visualStage)
  const track = usePlayerStore((s) => s.currentTrack)

  const mode = isFoliaModeId(stage) ? stage : null
  // `still` 自己画背景（不叠背景层），其余模式叠背景层；目前背景类没有在播的效果。
  const targets = mode
    ? {
        smartBeat,
        mode,
        modeHasOwnBackground: mode === 'still',
        backgroundHasBeats: false,
      }
    : null
  const wanted = targets ? visualizerWantsBeats(targets) : false
  const beatStrength = targets ? liveBeatEffectStrength(targets, 'beats', (id) => resolveBeatEffectSetting(smartBeat, id).strength) : 0
  // 效果与强度串成一个字符串，设置里别的地方变化不会触发重渲染。
  const liveEffects = targets
    ? liveBeatEffects(targets).map((effect) => `${effect.id}=${resolveBeatEffectSetting(smartBeat, effect.id).strength}`).join(',')
    : ''
  const identity = wanted && track ? currentBeatFxKey() : null
  /** 拍点表未就绪期间保持「就绪」的兜底；与上游 READY_HOLD_MS 同义，由 beatFxLive 内部管。 */
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setBeatFxIntensities(beatStrength, beatStrength)
  }, [beatStrength])

  useEffect(() => {
    const strengths: Record<string, number> = {}
    for (const pair of liveEffects.split(',')) {
      if (!pair) continue
      const at = pair.lastIndexOf('=')
      strengths[pair.slice(0, at)] = Number(pair.slice(at + 1))
    }
    setBeatFxLiveEffects(strengths)
  }, [liveEffects])

  useEffect(() => {
    cancelRef.current?.()
    cancelRef.current = null
    if (!wanted) {
      stopBeatFx()
      return
    }
    if (!identity) {
      beginBeatFxTrack(null)
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const begunKey = identity
    beginBeatFxTrack(begunKey)
    const load = () => {
      cancelRef.current?.()
      cancelRef.current = loadBeatFxTrack((result) => {
        if (cancelled) return
        setBeatFxEvents(begunKey, result.events, result.source === 'none' ? 'none' : 'beats', result.note, result.trackScale)
        // 播放源还没解析出来（在线曲目的 streamUrl 稍后才到）：稍后再排一次。
        if (result.source === 'none' && attempts < RETRY_ATTEMPTS) {
          attempts += 1
          retryTimer = setTimeout(load, RETRY_DELAY_MS)
          return
        }
        if (result.source === 'none') console.info(`[BeatFx] 这首歌没有拍点：${result.note ?? '未知'}`)
      })
    }
    load()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      cancelRef.current?.()
      cancelRef.current = null
    }
    // 只看歌曲身份与开关；`track` 对象会因为无关原因换引用。
  }, [identity, wanted])

  // 设置里换了「cached / on」要重新取一次（`on` 立刻分析，`cached` 停止在跑的）。
  const active = smartBeatActive(smartBeat)
  useEffect(() => {
    if (!active) stopBeatFx()
  }, [active])

  return wanted
}

/** 供视觉层引用：效果 id 常量（避免各处拼字符串）。 */
export { BEAT_EFFECT_IDS }
