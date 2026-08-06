import type { BilibiliMetadataSource, Track } from './types'

export const BILIBILI_METADATA_SOURCES: readonly BilibiliMetadataSource[] = ['netease', 'tencent', 'kugou', 'kugou_concept']

const bvidPattern = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/

export function bilibiliVideoId(track: Pick<Track, 'sourceId' | 'urlId'>): string | null {
  for (const value of [track.sourceId, track.urlId]) {
    const candidate = value.trim().split(/[?#]/)[0]
    if (bvidPattern.test(candidate)) return candidate
  }
  return null
}
