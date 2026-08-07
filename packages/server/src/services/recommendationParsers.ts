import type { MusicSource, Playlist } from '@music-together/shared'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    const result = String(value ?? '').trim()
    if (result) return result
  }
  return ''
}

function countValue(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const result = Number(value)
    if (Number.isFinite(result) && result >= 0) return Math.floor(result)
  }
  return 0
}

function uniquePlaylists(playlists: Playlist[]): Playlist[] {
  const seen = new Set<string>()
  return playlists.filter((playlist) => {
    if (!playlist.id || playlist.id === '0' || seen.has(playlist.id)) return false
    seen.add(playlist.id)
    return true
  })
}

/**
 * Field mapping ported from QQMusicApi's RecommendSonglistItem model and
 * RecommendSonglistResponse JSONPath extraction.
 * Source: https://github.com/l-1124/QQMusicApi
 * Commit: 108617ffe80abefec6358717b9f4d3677550db10
 * License: GPL-3.0
 */
export function parseTencentRecommendedPlaylists(value: unknown): Playlist[] {
  const root = asRecord(value)
  const req = asRecord(root?.req)
  const data = asRecord(req?.data) ?? asRecord(root?.data) ?? root
  const list = Array.isArray(data?.List) ? data.List : []

  return uniquePlaylists(
    list.flatMap((entry): Playlist[] => {
      const playlist = asRecord(asRecord(entry)?.Playlist)
      const basic = asRecord(playlist?.basic)
      if (!basic) return []

      const id = stringValue(basic.tid, basic.dissid, basic.id)
      if (!id || id === '0') return []

      const cover = asRecord(basic.cover)
      const creator = asRecord(basic.creator)
      return [
        {
          id,
          name: stringValue(basic.title, basic.dissname, basic.name) || 'Untitled playlist',
          cover: stringValue(
            cover?.default_url,
            typeof basic.cover === 'string' ? basic.cover : '',
            basic.picurl,
            basic.coverurl,
            basic.picUrl,
          ),
          trackCount: countValue(basic.song_cnt, basic.songnum, basic.songNum),
          creator: stringValue(creator?.nick),
          description: stringValue(basic.desc, basic.description),
          source: 'tencent',
        },
      ]
    }),
  )
}

export function parseNeteaseRecommendedPlaylists(value: unknown): Playlist[] {
  const root = asRecord(value)
  const body = asRecord(root?.body) ?? root
  const recommend = Array.isArray(value) ? value : Array.isArray(body?.recommend) ? body.recommend : []

  return uniquePlaylists(
    recommend.flatMap((entry): Playlist[] => {
      const item = asRecord(entry)
      if (!item) return []
      const id = stringValue(item.id)
      if (!id || id === '0') return []
      const creator = asRecord(item.creator)

      return [
        {
          id,
          name: stringValue(item.name) || 'Untitled playlist',
          cover: stringValue(item.picUrl, item.coverImgUrl),
          trackCount: countValue(item.trackCount),
          creator: stringValue(creator?.nickname),
          description: stringValue(item.description, item.copywriter),
          source: 'netease',
        },
      ]
    }),
  )
}

export function normalizeKugouRecommendationCover(value: unknown, size = 400): string {
  let url = stringValue(value).replace(/\{size\}/gi, String(size))
  if (!url) return ''
  if (url.startsWith('//')) url = `https:${url}`
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`
  url = url.replace(/^http:\/\//i, 'https://')
  return url.replace(/^https:\/\/imge\.kugou\.com/i, 'https://imgessl.kugou.com')
}

export function parseKugouRecommendedPlaylists(
  value: unknown,
  source: Extract<MusicSource, 'kugou' | 'kugou_concept'>,
): Playlist[] {
  const root = asRecord(value)
  const data = asRecord(root?.data) ?? root
  const list = Array.isArray(data?.special_list) ? data.special_list : []

  return uniquePlaylists(
    list.flatMap((entry): Playlist[] => {
      const item = asRecord(entry)
      if (!item) return []
      const id = stringValue(item.global_collection_id, item.specialid, item.special_id)
      if (!id || id === '0') return []

      return [
        {
          id,
          name: stringValue(item.specialname, item.name) || 'Untitled playlist',
          cover: normalizeKugouRecommendationCover(stringValue(item.imgurl, item.flexible_cover)),
          trackCount: countValue(item.songcount, item.song_count),
          creator: stringValue(item.nickname),
          description: stringValue(item.intro, item.description),
          source,
        },
      ]
    }),
  )
}
