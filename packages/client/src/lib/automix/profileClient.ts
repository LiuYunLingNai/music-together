import type { AutomixTrackProfile } from '@music-together/shared'
import type { BeatGrid } from '@/services/analysis/beatThis'
import { analyseWithBeatThis } from '@/services/analysis/beatThisAnalysis'
import { analyseTrackOffThread } from './analysisOffThread'
import { runExclusive } from './analysisQueue'
import { readCachedProfile, writeCachedProfile } from './profileCache'
import { PROFILE_SAMPLE_RATE } from './upstream/trackProfile'
import { fetchAudioBytes, commitAudioBytesToCache } from '@/lib/audioBytes'
import { wholeSongVerdict } from '@/lib/wholeSongCheck'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

/** 本次会话已经上报过画像的曲目；拍点分析与预取共用，避免重复跑整曲分析。 */
const reported = new Set<string>()

export const markProfileReported = (trackId: string): void => {
  reported.add(trackId)
}

export const hasProfileBeenReported = (trackId: string): boolean => reported.has(trackId)

let lastAnalysisMs = 0

/** 预取提前量：按上一次实测耗时留 2.5 倍余量；慢机自动提前，上限 4 分钟。 */
export const profilePrefetchLeadSec = (): number =>
  Math.min(240, Math.max(90, Math.round((lastAnalysisMs / 1000) * 2.5)))

const OfflineCtx = (): typeof OfflineAudioContext | undefined =>
  typeof window === 'undefined'
    ? undefined
    : window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext

/**
 * 为过渡决策计算一首歌的画像：整曲解码到分析采样率 → 单声道 + 侧声道 → 上游 `analyseTrack`。
 *
 * 只解一次：画像与 beat_this 共用这份 22.05k 立体声，而不是按设备采样率再解一遍
 * （上游 `PROFILE_SAMPLE_RATE` 同义，浮点内存降到四分之一）。
 * 任务串行执行，避免与分轨准备同时解码把内存峰值翻倍。
 */
export function analyseTrackUrl(
  url: string,
  trackKey?: string,
  statedDurationSec?: number,
): Promise<AutomixTrackProfile | null> {
  if (trackKey) {
    const cached = readCachedProfile(trackKey)
    if (cached) return Promise.resolve(cached)
  }
  return runExclusive(async () => {
    const started = performance.now()
    try {
      return await analyseTrackUrlInner(url, trackKey, statedDurationSec)
    } finally {
      lastAnalysisMs = performance.now() - started
    }
  })
}

async function analyseTrackUrlInner(
  url: string,
  trackKey?: string,
  statedDurationSec?: number,
): Promise<AutomixTrackProfile | null> {
  try {
    const bytes = await fetchAudioBytes(trackKey ?? url, url, {
      persist: true,
      statedDurationSec: statedDurationSec ?? null,
    })
    if (!bytes) return null
    const Ctx = OfflineCtx()
    if (!Ctx) return null
    const buffer = await new Ctx(2, 1, PROFILE_SAMPLE_RATE).decodeAudioData(bytes)
    commitAudioBytesToCache(trackKey ?? url, buffer.duration, statedDurationSec ?? null)
    // 片段不产出画像：否则整曲播放时会命中一份不完整的分析。
    if (wholeSongVerdict(buffer.duration, statedDurationSec) === 'not-the-song') return null
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
    const mono = new Float32Array(buffer.length)
    const side = buffer.numberOfChannels > 1 ? new Float32Array(buffer.length) : null
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] = (left[index]! + right[index]!) / 2
      if (side) side[index] = (left[index]! - right[index]!) / 2
    }

    // 有 beat_this 且用户开启了高精度拍点时才用模型；否则直接走本地分析，
    // 避免自动混音悄悄下载 41 MB 权重。
    let grid: BeatGrid | null = null
    if (useAudioSettingsStore.getState().highPrecisionBeats) {
      try {
        const analysis = await analyseWithBeatThis({ samples: mono, duration: buffer.duration }, () => true)
        if (analysis?.beats.length) {
          grid = { beats: analysis.beats, downbeats: analysis.downbeats }
        }
      } catch {
        // 模型不可用：`gridless` 会阻止下一次预取重复尝试。
      }
    }

    const profile = await analyseTrackOffThread(mono, PROFILE_SAMPLE_RATE, {
      side,
      grid,
      gridless: grid === null,
    })
    if (profile && trackKey) writeCachedProfile(trackKey, profile)
    return profile
  } catch {
    return null
  }
}
