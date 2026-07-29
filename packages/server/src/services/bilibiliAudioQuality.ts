import type { AudioQuality, BilibiliStreamFormat } from '@music-together/shared'

export type BilibiliAudioQuality = 'bilibili_64' | 'bilibili_132' | 'bilibili_192' | 'bilibili_hires'

export interface BilibiliAudioCandidate {
  raw: Record<string, unknown>
  id: number | null
  bandwidth: number
  codecs: string
  quality: BilibiliAudioQuality
  format: BilibiliStreamFormat
  providerFormat: string
}

const QUALITY_LADDER: BilibiliAudioQuality[] = ['bilibili_64', 'bilibili_132', 'bilibili_192', 'bilibili_hires']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function audioEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  return isRecord(value) ? [value] : []
}

function classifyAudio(raw: Record<string, unknown>, source: 'regular' | 'flac'): Omit<BilibiliAudioCandidate, 'raw'> {
  const idValue = Number(raw.id)
  const id = Number.isFinite(idValue) ? idValue : null
  const bandwidthValue = Number(raw.bandwidth)
  const bandwidth = Number.isFinite(bandwidthValue) && bandwidthValue > 0 ? bandwidthValue : 0
  const codecs = String(raw.codecs ?? '')
  const normalizedCodec = codecs.toLowerCase()

  if (source === 'flac' || normalizedCodec.includes('flac')) {
    return { id, bandwidth, codecs, quality: 'bilibili_hires', format: 'flac', providerFormat: 'FLAC' }
  }
  let quality: BilibiliAudioQuality
  if (id === 30280 || bandwidth >= 160_000) quality = 'bilibili_192'
  else if (id === 30232 || bandwidth >= 80_000) quality = 'bilibili_132'
  else quality = 'bilibili_64'

  return {
    id,
    bandwidth,
    codecs,
    quality,
    format: 'm4a',
    providerFormat: normalizedCodec.includes('mp4a.40.5') ? 'HE-AAC' : 'AAC-LC',
  }
}

/** Merge every audio location used by Bilibili's web DASH response. */
export function collectBilibiliAudioCandidates(dashValue: unknown): BilibiliAudioCandidate[] {
  if (!isRecord(dashValue)) return []

  const flac = isRecord(dashValue.flac) ? dashValue.flac.audio : undefined
  // E-AC-3 support differs across desktop browsers and operating systems.
  // Ignore Bilibili Dolby until synchronized clients can negotiate codecs.
  const sources: Array<['regular' | 'flac', Record<string, unknown>[]]> = [
    ['regular', audioEntries(dashValue.audio)],
    ['flac', audioEntries(flac)],
  ]

  const seen = new Set<string>()
  return sources.flatMap(([source, entries]) =>
    entries.flatMap((raw) => {
      const key = `${String(raw.id ?? '')}:${String(raw.baseUrl ?? raw.base_url ?? '')}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ raw, ...classifyAudio(raw, source) }]
    }),
  )
}

/** Select once from one DASH response; this function never performs network fallback requests. */
export function selectBilibiliAudioCandidate(
  candidates: BilibiliAudioCandidate[],
  target: AudioQuality,
): BilibiliAudioCandidate | null {
  const targetRank = QUALITY_LADDER.indexOf(target as BilibiliAudioQuality)
  const maximumRank = targetRank >= 0 ? targetRank : QUALITY_LADDER.indexOf('bilibili_192')

  return (
    [...candidates]
      .filter((candidate) => QUALITY_LADDER.indexOf(candidate.quality) <= maximumRank)
      .sort((left, right) => {
        const qualityDifference = QUALITY_LADDER.indexOf(right.quality) - QUALITY_LADDER.indexOf(left.quality)
        if (qualityDifference !== 0) return qualityDifference
        const codecDifference = Number(right.providerFormat === 'AAC-LC') - Number(left.providerFormat === 'AAC-LC')
        return codecDifference || right.bandwidth - left.bandwidth
      })[0] ?? null
  )
}
