import type { AudioQuality, MusicSource } from '@music-together/shared'

export type MembershipTier = 0 | 1 | 2

const PROVIDER_QUALITY_LADDERS: Record<Exclude<MusicSource, 'bilibili'>, AudioQuality[]> = {
  netease: [
    128,
    192,
    320,
    999,
    'netease_hires',
    'netease_jyeffect',
    'netease_dolby',
    'netease_spatial',
    'netease_master',
  ],
  tencent: [128, 192, 320, 'tencent_flac', 'tencent_master'],
  kugou: [128, 192, 320, 999, 'kugou_hires', 'kugou_master'],
  kugou_concept: [128, 192, 320, 999, 'kugou_hires', 'kugou_master'],
}

const MEMBERSHIP_QUALITY_CAP: Record<Exclude<MusicSource, 'bilibili'>, Record<MembershipTier, AudioQuality>> = {
  netease: { 0: 320, 1: 'netease_jyeffect', 2: 'netease_master' },
  tencent: { 0: 320, 1: 'tencent_flac', 2: 'tencent_master' },
  kugou: { 0: 320, 1: 'kugou_hires', 2: 'kugou_master' },
  kugou_concept: { 0: 320, 1: 'kugou_hires', 2: 'kugou_master' },
}

type QualityClass = 'standard' | 'higher' | 'high' | 'lossless' | 'hires' | 'vip' | 'svip'

function requestedQualityClass(quality: AudioQuality): QualityClass {
  if (quality === 128) return 'standard'
  if (quality === 192) return 'higher'
  if (quality === 320) return 'high'
  if (quality === 999 || quality === 'tencent_flac') return 'lossless'
  if (quality === 'netease_hires' || quality === 'kugou_hires') return 'hires'
  if (quality === 'netease_jyeffect') return 'vip'
  return 'svip'
}

function qualityForClass(source: Exclude<MusicSource, 'bilibili'>, qualityClass: QualityClass): AudioQuality {
  const bySource: Record<Exclude<MusicSource, 'bilibili'>, Record<QualityClass, AudioQuality>> = {
    netease: {
      standard: 128,
      higher: 192,
      high: 320,
      lossless: 999,
      hires: 'netease_hires',
      vip: 'netease_jyeffect',
      svip: 'netease_master',
    },
    tencent: {
      standard: 128,
      higher: 192,
      high: 320,
      lossless: 'tencent_flac',
      hires: 'tencent_flac',
      vip: 'tencent_flac',
      svip: 'tencent_master',
    },
    kugou: {
      standard: 128,
      higher: 192,
      high: 320,
      lossless: 999,
      hires: 'kugou_hires',
      vip: 'kugou_hires',
      svip: 'kugou_master',
    },
    kugou_concept: {
      standard: 128,
      higher: 192,
      high: 320,
      lossless: 999,
      hires: 'kugou_hires',
      vip: 'kugou_hires',
      svip: 'kugou_master',
    },
  }
  return bySource[source][qualityClass]
}

/** Choose one provider quality from the room preference and highest logged-in membership. */
export function getEffectiveQuality(
  source: MusicSource,
  requested: AudioQuality,
  vipType: MembershipTier,
): AudioQuality {
  if (source === 'bilibili') return requested

  const ladder = PROVIDER_QUALITY_LADDERS[source]
  const cap = MEMBERSHIP_QUALITY_CAP[source][vipType]
  const providerSpecific = ladder.includes(requested) ? requested : null
  const desired =
    requested === 'highest' ? cap : (providerSpecific ?? qualityForClass(source, requestedQualityClass(requested)))
  return ladder[Math.min(ladder.indexOf(desired), ladder.indexOf(cap))]
}

export function providerQualityRank(source: MusicSource, quality: AudioQuality): number {
  if (source === 'bilibili') return 0
  const exactRank = PROVIDER_QUALITY_LADDERS[source].indexOf(quality)
  if (exactRank !== -1) return exactRank
  const normalized = qualityForClass(source, requestedQualityClass(quality))
  return PROVIDER_QUALITY_LADDERS[source].indexOf(normalized)
}
