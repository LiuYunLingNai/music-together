import type { MusicSource } from '@music-together/shared'

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function upgradeCoverProtocol(value: string): string {
  const url = parseUrl(value)
  if (!url || url.protocol !== 'http:') return value
  url.protocol = 'https:'
  url.port = ''
  return url.toString()
}

/** Keep detail/player artwork at the highest provider-safe resolution. */
export function normalizeHighQualityCoverUrl(source: MusicSource, value: string): string {
  if (!value) return value

  const secureValue = source === 'bilibili' ? value : upgradeCoverProtocol(value)

  if (source === 'netease') {
    const url = parseUrl(secureValue)
    if (!url) return secureValue
    url.searchParams.delete('param')
    return url.toString()
  }

  if (source === 'tencent') return secureValue.replace(/T002R\d+x\d+M000/i, 'T002R800x800M000')
  if (source === 'kugou' || source === 'kugou_concept') return secureValue.replaceAll('{size}', '5000')
  return secureValue
}

/** Derive a separately cacheable small image without guessing unknown CDN layouts. */
export function deriveThumbnailCoverUrl(source: MusicSource, value: string): string {
  if (!value) return value

  if (source === 'netease') {
    const url = parseUrl(value)
    if (!url) return value
    url.searchParams.delete('param')
    url.searchParams.set('param', '120y120')
    return url.toString()
  }

  if (source === 'tencent') return value.replace(/T002R\d+x\d+M000/i, 'T002R120x120M000')

  if (source === 'kugou' || source === 'kugou_concept') {
    if (value.includes('{size}')) return value.replaceAll('{size}', '120')
    const url = parseUrl(value)
    if (!url || !/(^|\.)kugou\.(com|net)$/i.test(url.hostname)) return value
    const knownSizes = new Set([
      '100',
      '120',
      '150',
      '200',
      '240',
      '300',
      '320',
      '400',
      '480',
      '500',
      '600',
      '800',
      '1000',
      '1200',
      '2000',
      '3000',
      '5000',
    ])
    const segments = url.pathname.split('/')
    const index = segments.findIndex((segment) => knownSizes.has(segment))
    if (index < 0) return value
    segments[index] = '120'
    url.pathname = segments.join('/')
    return url.toString()
  }

  // Bilibili image processing suffixes vary by source URL; keep the original.
  return value
}

export function getCoverArtwork(source: MusicSource, value: string): { cover: string; thumbnailCover?: string } {
  const cover = normalizeHighQualityCoverUrl(source, value)
  const thumbnailCover = deriveThumbnailCoverUrl(source, cover)
  return thumbnailCover ? { cover, thumbnailCover } : { cover }
}
