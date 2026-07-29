import type { AudioQuality } from '@music-together/shared'

export type KugouProviderQuality =
  | '128'
  | '320'
  | 'flac'
  | 'high'
  | 'super'
  | 'viper_clear'
  | 'viper_tape'
  | 'viper_atmos'
  | 'multitrack'

export interface KugouV6Good {
  quality?: unknown
  hash?: unknown
  status?: unknown
  level?: unknown
  info?: {
    filesize?: unknown
    bitrate?: unknown
    extname?: unknown
    tracker_status?: unknown
    tracker_type?: unknown
    tracker_url?: unknown
    en_filesize?: unknown
    en_extname?: unknown
    en_tracker_url?: unknown
    en_ekey?: unknown
  }
  relate_goods?: unknown
}

export interface SelectedKugouV6Good {
  quality: KugouProviderQuality
  hash: string
  bitrate: number | null
  fileSize?: number
  plainUrl?: string
  encryptedUrl?: string
  encryptedFileSize?: number
  encryptedExtension?: string
  ekey?: string
  raw: KugouV6Good
}

const TECHNICAL_STEREO_QUALITIES = new Set<KugouProviderQuality>([
  '128',
  '320',
  'flac',
  'high',
  'super',
  'viper_clear',
])

function firstUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const url = value.find((item) => typeof item === 'string' && item.length > 0)
    return typeof url === 'string' ? url.replace(/^http:\/\//, 'https://') : undefined
  }
  return typeof value === 'string' && value ? value.replace(/^http:\/\//, 'https://') : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function normalizeGood(raw: KugouV6Good): SelectedKugouV6Good | null {
  const quality = String(raw.quality ?? '').toLowerCase() as KugouProviderQuality
  if (!TECHNICAL_STEREO_QUALITIES.has(quality) && quality !== 'viper_tape') return null
  if (Number(raw.status) !== 1 || Number(raw.info?.tracker_status) !== 1 || raw.info?.tracker_type !== 'full') return null
  const plainUrl = firstUrl(raw.info?.tracker_url)
  const encryptedUrl = firstUrl(raw.info?.en_tracker_url)
  const ekey = typeof raw.info?.en_ekey === 'string' && raw.info.en_ekey ? raw.info.en_ekey : undefined
  if (!plainUrl && (!encryptedUrl || !ekey)) return null
  return {
    quality,
    hash: String(raw.hash ?? ''),
    bitrate: positiveNumber(raw.info?.bitrate) ?? null,
    fileSize: positiveNumber(raw.info?.filesize),
    plainUrl,
    encryptedUrl,
    encryptedFileSize: positiveNumber(raw.info?.en_filesize),
    encryptedExtension:
      typeof raw.info?.en_extname === 'string' ? raw.info.en_extname.toLowerCase().replace(/^\./, '') : undefined,
    ekey,
    raw,
  }
}

export function collectKugouV6Goods(response: Record<string, unknown>): SelectedKugouV6Good[] {
  const data = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
  const rawGoods: KugouV6Good[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const root = item as KugouV6Good
    rawGoods.push(root)
    if (Array.isArray(root.relate_goods)) rawGoods.push(...(root.relate_goods as KugouV6Good[]))
  }

  const seen = new Set<string>()
  return rawGoods.flatMap((raw) => {
    const good = normalizeGood(raw)
    if (!good) return []
    const key = `${good.quality}:${good.hash.toLowerCase()}`
    if (seen.has(key)) return []
    seen.add(key)
    return [good]
  })
}

function technicalScore(good: SelectedKugouV6Good): [number, number, number] {
  const defaultBitrate: Record<KugouProviderQuality, number> = {
    '128': 128,
    '320': 320,
    flac: 900,
    high: 1800,
    super: 4000,
    viper_clear: 3500,
    viper_tape: 320,
    viper_atmos: 0,
    multitrack: 0,
  }
  return [good.bitrate ?? defaultBitrate[good.quality], good.fileSize ?? good.encryptedFileSize ?? 0, defaultBitrate[good.quality]]
}

function byTechnicalQuality(left: SelectedKugouV6Good, right: SelectedKugouV6Good): number {
  const a = technicalScore(left)
  const b = technicalScore(right)
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]
}

export function selectKugouV6Good(
  goods: SelectedKugouV6Good[],
  requested: AudioQuality,
): SelectedKugouV6Good | null {
  const exact = (qualities: KugouProviderQuality[]) =>
    qualities.flatMap((quality) => goods.filter((good) => good.quality === quality).sort(byTechnicalQuality))[0]

  if (requested === 'kugou_master') {
    return exact(['viper_tape']) ?? selectKugouV6Good(goods, 'kugou_hires')
  }
  if (requested === 'kugou_hires' || requested === 'highest') {
    return goods.filter((good) => TECHNICAL_STEREO_QUALITIES.has(good.quality)).sort(byTechnicalQuality)[0] ?? null
  }
  if (typeof requested === 'number' && requested >= 999) return exact(['flac', '320', '128']) ?? null
  if (typeof requested === 'number' && requested >= 320) return exact(['320', '128']) ?? null
  return exact(['128']) ?? null
}

export function kugouProviderQualityToAudioQuality(quality: KugouProviderQuality): AudioQuality {
  if (quality === 'viper_tape') return 'kugou_master'
  if (quality === 'super' || quality === 'viper_clear' || quality === 'high') return 'kugou_hires'
  if (quality === 'flac') return 999
  if (quality === '320') return 320
  return 128
}
