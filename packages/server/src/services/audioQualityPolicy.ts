import type { AudioQuality, MusicSource } from '@music-together/shared'

export type MembershipTier = 0 | 1 | 2

const PROVIDER_QUALITY_LADDERS: Record<MusicSource, AudioQuality[]> = {
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
  bilibili: ['bilibili_64', 'bilibili_132', 'bilibili_192', 'bilibili_hires'],
}

const MEMBERSHIP_QUALITY_CAP: Record<MusicSource, Record<MembershipTier, AudioQuality>> = {
  netease: { 0: 320, 1: 'netease_jyeffect', 2: 'netease_master' },
  // QQ Music: 1 = 绿钻VIP (FLAC), 2 = 超级会员 (臻品母带).
  tencent: { 0: 320, 1: 'tencent_flac', 2: 'tencent_master' },
  kugou: { 0: 320, 1: 'kugou_hires', 2: 'kugou_master' },
  // The daily Concept Edition listening benefit is a non-paid business VIP.
  // Live provider verification shows it permits FLAC but not viper_clear/tape.
  kugou_concept: { 0: 320, 1: 999, 2: 'kugou_master' },
  // Bilibili exposes Hi-Res only when both the account and video permit it.
  bilibili: { 0: 'bilibili_192', 1: 'bilibili_hires', 2: 'bilibili_hires' },
}

function normalizeMembershipTier(source: MusicSource, vipType: MembershipTier): MembershipTier {
  return source === 'netease' ? (vipType === 2 ? 2 : vipType > 0 ? 1 : 0) : vipType >= 2 ? 2 : vipType > 0 ? 1 : 0
}

/** Return every provider-specific tier permitted by the room's best account. */
export function getAvailableAudioQualities(source: MusicSource, vipType: MembershipTier): AudioQuality[] {
  const ladder = PROVIDER_QUALITY_LADDERS[source]
  const cap = MEMBERSHIP_QUALITY_CAP[source][normalizeMembershipTier(source, vipType)]
  return ladder.slice(0, ladder.indexOf(cap) + 1)
}

export function getKugouQualityFallbacks(requested: AudioQuality): AudioQuality[] {
  const ladder: AudioQuality[] = [128, 320, 999, 'kugou_hires', 'kugou_master']
  const exactIndex = ladder.indexOf(requested)
  const highestIndex =
    exactIndex >= 0
      ? exactIndex
      : Math.min(ladder.indexOf(qualityForClass('kugou', requestedQualityClass(requested))), ladder.length - 1)
  return ladder.slice(0, highestIndex + 1).reverse()
}

type QualityClass = 'standard' | 'higher' | 'high' | 'lossless' | 'hires' | 'vip' | 'svip'

function requestedQualityClass(quality: AudioQuality): QualityClass {
  if (quality === 128) return 'standard'
  if (quality === 192) return 'higher'
  if (quality === 320) return 'high'
  if (quality === 999 || quality === 'tencent_flac') return 'lossless'
  if (quality === 'netease_hires' || quality === 'kugou_hires') return 'hires'
  if (quality === 'bilibili_64') return 'standard'
  if (quality === 'bilibili_132') return 'higher'
  if (quality === 'bilibili_192') return 'high'
  if (quality === 'bilibili_hires') return 'hires'
  if (quality === 'netease_jyeffect') return 'vip'
  return 'svip'
}

function qualityForClass(source: MusicSource, qualityClass: QualityClass): AudioQuality {
  const bySource: Record<MusicSource, Record<QualityClass, AudioQuality>> = {
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
    bilibili: {
      standard: 'bilibili_132',
      higher: 'bilibili_192',
      high: 'bilibili_192',
      lossless: 'bilibili_hires',
      hires: 'bilibili_hires',
      vip: 'bilibili_hires',
      svip: 'bilibili_hires',
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
  const ladder = PROVIDER_QUALITY_LADDERS[source]
  // Persisted accounts from older versions used provider-specific numbers
  // (for example Netease 10/11). Keep the policy total even if one reaches
  // this function before the account restore path normalizes that value.
  const normalizedVipType = normalizeMembershipTier(source, vipType)
  const cap = MEMBERSHIP_QUALITY_CAP[source][normalizedVipType]
  const providerSpecific = ladder.includes(requested) ? requested : null
  const highest = (source === 'kugou' || source === 'kugou_concept') && normalizedVipType >= 2 ? 'kugou_hires' : cap
  const desired =
    requested === 'highest' ? highest : (providerSpecific ?? qualityForClass(source, requestedQualityClass(requested)))
  return ladder[Math.min(ladder.indexOf(desired), ladder.indexOf(cap))]
}

export function providerQualityRank(source: MusicSource, quality: AudioQuality): number {
  const exactRank = PROVIDER_QUALITY_LADDERS[source].indexOf(quality)
  if (exactRank !== -1) return exactRank
  const normalized = qualityForClass(source, requestedQualityClass(quality))
  return PROVIDER_QUALITY_LADDERS[source].indexOf(normalized)
}
