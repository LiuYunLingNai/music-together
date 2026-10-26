import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { SERVER_URL } from '@/lib/config'
import { scheduleBeatAnalysis, type BeatMap } from './offlineBeatAnalysis'
import { beatTimesOf, downbeatTimesOf, resolveBeatAccents } from './beatAccents'
import { mergeBeatFxEvents, type BeatFxEvent } from './clock'

/**
 * 拍点表的来源 —— 上游 `src/services/beatFx/beatFxSource.ts` 的宿主实现。
 *
 * 上游从 beat_this（Electron 主进程的 ONNX 模型）取拍点；本仓改用已有的
 * `offlineBeatAnalysis`（本地 onset + music-tempo 网格，Mineradio 的离线拍点图）。
 * 产出对下游完全一致：一组排好序的 `BeatFxEvent`（含重音、小节位置）与动感系数。
 *
 * 每次排分析有自己的代次：切歌或重新排一次就作废上一次，与播放源严格同步。
 */
export type BeatFxSourceKind = 'beats' | 'drums' | 'none'

export interface BeatFxTrackResult {
  events: BeatFxEvent[]
  source: BeatFxSourceKind
  /** 未就绪的原因（诊断用）。 */
  note?: string
  /** 整首歌的动感系数（0.45..1）。 */
  trackScale: number
}

const EMPTY: BeatFxTrackResult = { events: [], source: 'none', trackScale: 1 }

/** 与播放同源的音频 URL（代理规则与 `useHowl` / Mineradio 一致，否则分析拿到 403）。 */
export function resolveAnalysisUrl(track: NonNullable<ReturnType<typeof usePlayerStore.getState>['currentTrack']>): string | null {
  if (!track.streamUrl) return null
  const roomId = useRoomStore.getState().room?.id ?? ''
  if (track.source === 'bilibili') {
    return `${SERVER_URL}/api/music/bilibili-audio-proxy?url=${encodeURIComponent(track.streamUrl)}&bvid=${encodeURIComponent(track.urlId)}&roomId=${encodeURIComponent(roomId)}`
  }
  if (track.source === 'kugou' || track.source === 'kugou_concept') {
    return `${SERVER_URL}/api/music/kugou-audio-proxy?url=${encodeURIComponent(track.streamUrl)}`
  }
  return track.streamUrl
}

/** 当前播放会话的键；切歌 / 重连即变，用来判定拍点表是否还属于这首歌。 */
export function currentBeatFxKey(): string | null {
  const track = usePlayerStore.getState().currentTrack
  if (!track) return null
  // 曲目身份 + 流地址：同一首歌重新解析出新的直链时也要重analyze 一次。
  return `${track.source}:${track.lyricId ?? track.urlId ?? track.title}:${track.streamUrl?.slice(-48) ?? ''}`
}

/** 拍点图 → 拍点表（合并重音）。 */
export function toBeatFxEvents(map: BeatMap): { events: BeatFxEvent[]; trackScale: number } {
  const accents = resolveBeatAccents(map)
  const events = mergeBeatFxEvents(beatTimesOf(map), downbeatTimesOf(map), accents)
  return { events, trackScale: accents?.trackScale ?? 1 }
}

/**
 * 每一次排分析的代次。用它（而不是 `audioTapRevision`）判「这次分析还算不算数」：
 * 拍点表只跟**排这次分析的歌**绑，与音频探针什么时候重新发布无关 ——
 * 用探针代次会在「排分析时音频图还没建好」的情况下永远判为过期，整首歌拿不到拍点。
 */
let loadSequence = 0

/**
 * 为当前歌曲排一次离线拍点分析。
 *
 * 返回取消函数；调用方在切歌或开关变化时先取消。分析本身有 1.6s 起步延迟与空闲调度，
 * 由 `offlineBeatAnalysis` 的调度器负责，这里不重复节流。
 */
export function loadBeatFxTrack(onResult: (result: BeatFxTrackResult) => void): () => void {
  const track = usePlayerStore.getState().currentTrack
  const url = track ? resolveAnalysisUrl(track) : null
  loadSequence += 1
  const token = loadSequence
  if (!url) {
    onResult({ ...EMPTY, note: '没有播放地址' })
    return () => {}
  }
  const handle = scheduleBeatAnalysis(
    url,
    {
      token,
      currentTime: () => usePlayerStore.getState().currentTime,
      isPlaying: () => usePlayerStore.getState().isPlaying,
      isCurrent: (candidate) => candidate === loadSequence,
      onMap: (map) => {
        if (token !== loadSequence) return
        const { events, trackScale } = toBeatFxEvents(map)
        onResult(events.length > 0
          ? { events, source: 'beats', trackScale }
          : { ...EMPTY, note: `拍点图只有 ${map.cameraBeats.length} 个拍点` })
      },
    },
    track ? { name: track.title, artist: track.artist?.[0] } : undefined,
  )
  const cancel = handle.cancel
  return () => {
    // 取消后这次分析的结果一律作废，但不要把代次推到别人头上：
    // 只有「我仍是当前那一次」时才需要作废（调用方随后会立刻排新的）。
    if (token === loadSequence) loadSequence += 1
    cancel()
  }
}
